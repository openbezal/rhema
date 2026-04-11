//! Real ONNX Runtime embedder using `ort` and HuggingFace `tokenizers`.
//!
//! This module is only compiled when the `onnx` feature is enabled.

#[cfg(feature = "onnx")]
use std::path::Path;
#[cfg(feature = "onnx")]
use std::sync::Mutex;

#[cfg(feature = "onnx")]
use ort::session::Session;
#[cfg(feature = "onnx")]
use ort::value::Tensor;
#[cfg(feature = "onnx")]
use tokenizers::Tokenizer;

#[cfg(feature = "onnx")]
use crate::error::DetectionError;
#[cfg(feature = "onnx")]
use super::embedder::TextEmbedder;

/// ONNX-based text embedder.
#[cfg(feature = "onnx")]
pub struct OnnxEmbedder {
    session: Mutex<Session>,
    tokenizer: Mutex<Tokenizer>,
    dim: usize,
    prompt_prefix: String,
    has_position_ids: bool,
}

#[cfg(feature = "onnx")]
unsafe impl Sync for OnnxEmbedder {}

#[cfg(feature = "onnx")]
impl OnnxEmbedder {
    /// Maximum number of tokens the model will accept.
    const MAX_TOKENS: usize = 128;

    /// Load an ONNX model and its tokenizer from disk.
    pub fn load(model_path: &Path, tokenizer_path: &Path) -> Result<Self, DetectionError> {
        let mut tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| DetectionError::Tokenizer(e.to_string()))?;

        Self::configure_tokenizer(&mut tokenizer)?;

        let num_cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let intra_threads = (num_cpus / 2).max(1);

        log::info ! (
            "OnnxEmbedder: configuring session with {} intra-op threads (of {} CPUs)",
            intra_threads, num_cpus
        );

        let session = Session::builder()?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)?
            .with_intra_threads(intra_threads)?
            .with_inter_threads(2)?
            .commit_from_file(model_path)?;

        let has_position_ids = session.inputs().iter().any(|i| i.name() == "position_ids");

        // Determine embedding dimension from output shape
        let dim = session
            .outputs()
            .first()
            .and_then(|outlet| {
                if let ort::value::ValueType::Tensor { ref shape, .. } = *outlet.dtype() {
                    shape.last().copied()
                } else {
                    None
                }
            })
            .unwrap_or(-1);

        if dim <= 0 {
            return Err(DetectionError::Internal(
                "cannot determine embedding dimension from model output shape".into(),
            ));
        }

        log::info ! (
            "OnnxEmbedder loaded: dim={}, model={:?}",
            dim,
            model_path.file_name().unwrap_or_default()
        );

        Ok(Self {
            session: Mutex::new(session),
            tokenizer: Mutex::new(tokenizer),
            dim: dim as usize,
            prompt_prefix: String::new(),
            has_position_ids,
        })
    }

    fn configure_tokenizer(tokenizer: &mut Tokenizer) -> Result<(), DetectionError> {
        let pad_id = tokenizer.get_vocab(true).get("[PAD]").copied().unwrap_or(0);
        let pad_token = tokenizer.id_to_token(pad_id).unwrap_or_else(|| "[PAD]".to_string());

        tokenizer.with_padding(Some(tokenizers::PaddingParams {
            strategy: tokenizers::PaddingStrategy::Fixed(Self::MAX_TOKENS),
            pad_id,
            pad_token,
            ..Default::default()
        }));

        tokenizer.with_truncation(Some(tokenizers::TruncationParams {
            max_length: Self::MAX_TOKENS,
            ..Default::default()
        })).map_err(|e| DetectionError::Tokenizer(e.to_string()))?;

        Ok(())
    }

    pub fn set_prompt_prefix(&mut self, prefix: impl Into<String>) {
        self.prompt_prefix = prefix.into();
    }

    fn embed_impl(&self, text: &str) -> Result<Vec<f32>, DetectionError> {
        let embed_start = std::time::Instant::now();
        let prefixed = format!("{}{}", self.prompt_prefix, text);

        use rhema_core::MutexExt;
        let tokenizer = self.tokenizer.lock_safe()?;
        let encoding = tokenizer.encode(prefixed, true)
            .map_err(|e| DetectionError::Tokenizer(e.to_string()))?;
        drop(tokenizer);

        let ids = encoding.get_ids();
        let mask = encoding.get_attention_mask();
        let seq_len = ids.len();

        let shape = vec![1i64, seq_len as i64];
        let input_ids_data: Vec<i64> = ids.iter().map(|&v| v as i64).collect();
        let input_ids_tensor = Tensor::from_array((shape.clone(), input_ids_data))?;

        let attention_mask_data: Vec<i64> = mask.iter().map(|&v| v as i64).collect();
        let attention_mask_tensor = Tensor::from_array((shape.clone(), attention_mask_data))?;

        let position_ids_data: Vec<i64> = (0..seq_len as i64).collect();
        let position_ids_tensor = Tensor::from_array((shape, position_ids_data))?;

        let inputs = if self.has_position_ids {
            ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
                "position_ids" => position_ids_tensor,
            ]
        } else {
            ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
            ]
        }?;

        let mut session = self.session.lock_safe()?;
        let outputs = session.run(inputs)?;
        
        let output_value = if outputs.contains_key("sentence_embedding") {
            &outputs["sentence_embedding"]
        } else if outputs.contains_key("last_hidden_state") {
            &outputs["last_hidden_state"]
        } else {
            &outputs[0usize]
        };

        let (out_shape, data) = output_value.try_extract_tensor::<f32>()?;
        let out_dims: &[i64] = &*out_shape;

        let pooled = if out_dims.len() == 2 {
            let dim = out_dims[1] as usize;
            data[..dim].to_vec()
        } else if out_dims.len() == 3 {
            let seq_len = out_dims[1] as usize;
            let dim = out_dims[2] as usize;
            let mut pooled = vec![0.0f32; dim];
            let mut mask_sum = 0.0f32;
            for tok in 0..seq_len {
                if mask[tok] > 0 {
                    let offset = tok * dim;
                    for d in 0..dim {
                        pooled[d] += data[offset + d];
                    }
                    mask_sum += 1.0;
                }
            }
            if mask_sum > 0.0 {
                for d in 0..dim { pooled[d] /= mask_sum; }
            }
            pooled
        } else {
            return Err(DetectionError::Internal(format!("unexpected tensor rank: {:?}", out_dims)));
        };

        let mut result = pooled;
        let norm: f32 = result.iter().map(|v| v * v).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in result.iter_mut() { *v /= norm; }
        }

        log::info ! ("[ONNX] embed() took {:?} for {} chars", embed_start.elapsed(), text.len());
        Ok(result)
    }
}

#[cfg(feature = "onnx")]
impl TextEmbedder for OnnxEmbedder {
    fn embed(&self, text: &str) -> Result<Vec<f32>, DetectionError> {
        self.embed_impl(text)
    }

    fn dimension(&self) -> usize {
        self.dim
    }
}
