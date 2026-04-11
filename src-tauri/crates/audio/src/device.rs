use cpal::traits::{DeviceTrait, HostTrait};

use crate::error::AudioError;
use crate::types::DeviceInfo;

/// Enumerate all available audio input devices.
/// The default input device is marked with `is_default: true`.
pub fn enumerate_devices() -> Result<Vec<DeviceInfo>, AudioError> {
    let host = cpal::default_host();

    let default_device_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let input_devices = host
        .input_devices()
        .map_err(|e| AudioError::StreamError(format!("Failed to enumerate input devices: {e}")))?;

    let mut devices = Vec::new();

    for device in input_devices {
        let name = device
            .name()
            .unwrap_or_else(|_| "Unknown Device".to_string());

        let default_config = device
            .default_input_config()
            .map_err(|e| {
                AudioError::StreamError(format!(
                    "Failed to get default config for device '{name}': {e}"
                ))
            })?;

        let is_default = default_device_name
            .as_ref()
            .is_some_and(|dn| dn == &name);

        devices.push(DeviceInfo {
            id: name.clone(),
            name: name.clone(),
            sample_rate: default_config.sample_rate().0,
            channels: default_config.channels(),
            is_default,
        });
    }

    if devices.is_empty() {
        return Err(AudioError::NoInputDevices);
    }

    Ok(devices)
}
