# Whisper Speech-to-Text Transcription

Rhema supports local speech-to-text transcription using OpenAI's Whisper model. This allows you to transcribe sermons and audio in real-time without requiring an internet connection or external API keys.

## Overview

Whisper provides:
- **Local processing** - All transcription happens on your device
- **No API costs** - Unlike Deepgram, Whisper is completely free
- **Offline capability** - Works without internet connection
- **High accuracy** - State-of-the-art speech recognition
- **Multiple languages** - Supports 99 languages

## How It Works

1. **Audio Capture** - Rhema captures audio from your selected input device (microphone, line-in, etc.)
2. **Processing** - Audio is processed locally using the Whisper model
3. **Transcription** - Text appears in the Live Transcript panel
4. **Verse Detection** - Automatically detects Bible verses mentioned in the transcript
5. **Queue Management** - Detected verses are added to the queue for presentation

## Setup Requirements

### System Requirements

- **macOS**: 11.0 or later (Apple Silicon recommended for best performance)
- **Memory**: At least 4GB RAM (8GB+ recommended for larger models)
- **Storage**: 1-3GB for model files (depending on model size)

### Installation

Whisper support requires CMake to be installed:

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install CMake
brew install cmake
```

The Whisper model will be downloaded automatically on first use.

## Usage

### Starting Transcription

1. **Open Settings** (⚙️ gear icon)
2. **Select Audio Device** under "Audio" tab
   - Choose your microphone or audio input source
   - Adjust gain if needed (default: 1.0)

3. **Start Transcribing**
   - Click the "Start transcribing" button in the Live Transcript panel
   - Speak clearly into your microphone
   - Watch as text appears in real-time

### Transcription Controls

- **Start/Stop** - Begin or pause transcription
- **Clear** - Remove all transcribed text
- **Auto-scroll** - Automatically scroll to latest text (enabled by default)

## Model Selection

Rhema uses Whisper models optimized for real-time transcription:

### Available Models

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| Tiny | ~75MB | Fastest | Good | Quick tests, fast machines |
| Base | ~150MB | Fast | Better | Real-time transcription |
| Small | ~500MB | Medium | Great | **Recommended for most users** |
| Medium | ~1.5GB | Slower | Excellent | High accuracy needs |
| Large | ~3GB | Slowest | Best | Maximum accuracy |

**Default**: Rhema uses the **small** model by default, which provides the best balance of speed and accuracy for live transcription.

## Comparison: Whisper vs. Deepgram

| Feature | Whisper (Local) | Deepgram (Cloud) |
|---------|----------------|------------------|
| **Cost** | Free | Requires API key + usage fees |
| **Internet** | Not required | Required |
| **Privacy** | Complete | Data sent to cloud |
| **Speed** | Depends on hardware | Very fast |
| **Accuracy** | Excellent | Excellent |
| **Setup** | One-time model download | API key configuration |

### When to Use Whisper

✅ **Use Whisper if you:**
- Want completely free transcription
- Need offline capability
- Prioritize privacy (local processing)
- Have decent hardware (8GB+ RAM recommended)
- Don't mind slightly slower processing

### When to Use Deepgram

✅ **Use Deepgram if you:**
- Need the fastest possible transcription
- Have reliable internet connection
- Don't mind cloud processing
- Are willing to pay for API usage
- Need real-time streaming with minimal latency

## Troubleshooting

### "cmake not installed" Error

If you see an error about CMake during build:

```bash
brew install cmake
```

Then restart the Rhema app.

### Transcription Not Starting

1. **Check Audio Device**
   - Open Settings → Audio
   - Ensure correct device is selected
   - Test with system sound preferences

2. **Check Permissions**
   - Grant microphone access when prompted
   - System Preferences → Security & Privacy → Microphone → Enable Rhema

### Poor Accuracy

1. **Reduce Background Noise**
   - Use a quality microphone
   - Minimize ambient noise
   - Position microphone closer to speaker

2. **Adjust Gain**
   - Open Settings → Audio
   - Increase gain if audio is too quiet
   - Decrease gain if audio is distorting

3. **Upgrade Model**
   - Consider using the "medium" or "large" model for better accuracy
   - Note: Larger models are slower

### Slow Performance

1. **Use Smaller Model**
   - Switch to "base" or "tiny" model for faster processing
   - Trade-off: slightly lower accuracy

2. **Close Other Apps**
   - Free up system resources
   - Whisper is CPU/GPU intensive

## Technical Details

### Model Location

Whisper models are cached locally:
- **macOS**: `~/Library/Caches/whisper-rs/`
- Models are downloaded once and reused

### Audio Processing

- **Sample Rate**: 16kHz (optimal for speech)
- **Channels**: Mono (converted automatically)
- **Format**: WAV/PCM for processing
- **Chunk Size**: Adaptive based on speech pauses

### Language Detection

Whisper automatically detects the spoken language. For best results:
- Speak clearly in one primary language
- Avoid mixing languages mid-sentence
- English is optimized by default

## Advanced Configuration

### Command Line Options

(Future feature - model selection will be available in Settings)

### Performance Tuning

For optimal performance:
1. **Use Apple Silicon Macs** - M1/M2/M3 chips have excellent performance
2. **Close unnecessary apps** - Free up RAM and CPU
3. **Use wired microphones** - Reduce wireless latency
4. **Enable hardware acceleration** - Automatic on supported devices

## Support

For issues or questions:
- Check the main [README](../README.md)
- Report bugs on GitHub
- Check logs in Console.app (search for "Rhema")

---

**Next Steps:**
- Learn about [Remote Control](./remote-control.md) for external control
- See [README](../README.md) for general usage
