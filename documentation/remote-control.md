# Remote Control

Rhema provides two remote control protocols for external integration: **OSC** (Open Sound Control) and **HTTP API**. These allow you to control broadcasts, navigate verses, switch themes, and adjust settings from hardware controllers, automation scripts, or custom dashboards.

## Overview

Remote control enables you to:
- **Navigate the queue** - Advance or go back through your verse queue
- **Read through a passage** - Step the Bible Text panel verse by verse, independently of the queue
- **Drive the Live output** - Send the current Preview to Live
- **Build the queue** - Add the previewed verse to the queue
- **Control broadcast** - Show/hide output, toggle on-air status
- **Switch themes** - Change active broadcast theme by name
- **Adjust settings** - Modify confidence threshold and opacity
- **Monitor status** - Query current state via HTTP API

## Supported Protocols

| Protocol | Port | Transport | Best For |
|----------|------|-----------|----------|
| **OSC** | 8000 | UDP | Hardware controllers (Stream Deck, TouchOSC, Companion) |
| **HTTP** | 8080 | TCP/HTTP | REST clients, automation scripts, custom dashboards |

Both protocols support the same command set and can run simultaneously.

## Setup

### Enabling Remote Control

1. **Open Settings** (⚙️ gear icon)
2. Navigate to the **Remote** tab
3. Configure OSC and/or HTTP:

#### OSC (Open Sound Control)

- **Toggle**: Enable/disable OSC listener
- **Port**: Default `8000` (UDP)
- **Host**: Binds to `0.0.0.0` (all network interfaces)

#### HTTP API

- **Toggle**: Enable/disable HTTP server
- **Port**: Default `8080` (TCP)
- **Host**: Binds to `0.0.0.0` (all network interfaces)

### Firewall & Network

If accessing Rhema from another device on your network:
- Allow incoming connections on your chosen ports (default 8000/8080)
- Use your computer's local IP address (e.g., `192.168.1.100`)
- For local-only access, change host to `127.0.0.1` in settings

## Available Commands

All commands are case-insensitive and use the same structure across both protocols.

### 1. **next** — Advance to Next Verse

Moves forward in the verse queue and presents the next verse.

**OSC:**
```
/rhema/next
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"next"}'
```

### 2. **prev** — Go to Previous Verse

Moves backward in the verse queue and presents the previous verse.

**OSC:**
```
/rhema/prev
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"prev"}'
```

### 3. **show** — Show Broadcast Output

Makes the broadcast output visible (sets live state to true).

**OSC:**
```
/rhema/show
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"show"}'
```

### 4. **hide** — Hide Broadcast Output

Hides the broadcast output (sets live state to false).

**OSC:**
```
/rhema/hide
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"hide"}'
```

### 5. **on_air** — Toggle On-Air Status

Sets the broadcast live state to a specific value.

**Parameters:**
- `value` (boolean): `true` to go live, `false` to go off-air

**OSC:**
```
/rhema/on_air true
/rhema/on_air false
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"on_air","value":true}'
```

### 6. **theme** — Switch Active Theme

Changes the active broadcast theme by name (case-insensitive).

**Parameters:**
- `value` (string): Theme name (e.g., "Classic Dark", "Minimal", "Bold")

**OSC:**
```
/rhema/theme "Classic Dark"
/rhema/theme "Minimal"
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"theme","value":"Classic Dark"}'
```

### 7. **opacity** — Set Broadcast Opacity

Adjusts the opacity of the broadcast output.

**Parameters:**
- `value` (float): Opacity from 0.0 (transparent) to 1.0 (opaque)

**OSC:**
```
/rhema/opacity 0.75
/rhema/opacity 1.0
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"opacity","value":0.75}'
```

**Note:** This command is currently a placeholder and will be fully wired when the broadcast store adds opacity support.

### 8. **confidence** — Set Detection Confidence Threshold

Adjusts the minimum confidence threshold for verse detection.

**Parameters:**
- `value` (float): Confidence threshold from 0.0 to 1.0

**OSC:**
```
/rhema/confidence 0.8
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"confidence","value":0.8}'
```

### 9. **send_to_live** — Send the Preview to the Live Display

Puts the verse currently showing in **Program preview** on the Live output — the same thing
the panel's "Send to live" button does.

Detections that Rhema is confident about go straight to Live; everything else stages in
Preview first. This command is how you push a staged verse out without touching the app
window. If nothing is in Preview, the command does nothing — it will never blank what the
congregation is seeing.

**OSC:**
```
/rhema/send_to_live
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"send_to_live"}'
```

### 10. **bible_next** — Next Verse in the Bible Text Panel

Moves the **Bible Text** panel's selection forward one verse and scrolls it into view. The
verse lands in Preview, ready for `send_to_live`.

This is separate from `next`, which moves the **Queue**. Use `bible_next` to read straight
through a passage the AI has not picked up yet; the Queue does not move.

At the end of a chapter it continues into the next chapter of the same book. At the end of a
book it stops — it does not roll over into the next book.

**OSC:**
```
/rhema/bible_next
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"bible_next"}'
```

### 11. **bible_prev** — Previous Verse in the Bible Text Panel

The reverse of `bible_next`. At the start of a chapter it continues into the last verse of the
previous chapter; at the start of a book it stops.

**OSC:**
```
/rhema/bible_prev
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"bible_prev"}'
```

### 12. **add_to_queue** — Add the Previewed Verse to the Queue

Adds the verse currently showing in Preview to the Queue, exactly as the **+** button on a
verse row does. Pressing it twice for the same verse is harmless — the Queue rejects
duplicates.

**OSC:**
```
/rhema/add_to_queue
```

**HTTP:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"add_to_queue"}'
```

> **Note on arguments:** `send_to_live`, `bible_next`, `bible_prev` and `add_to_queue` take no
> arguments.
>
> Over **OSC** this is forgiving: controllers that send a value with every button press
> (TouchOSC and Companion both do) work fine — the extra argument is ignored. Verified with
> `/rhema/bible_next` carrying a float and `/rhema/add_to_queue` carrying an int; both dispatch
> normally.
>
> Over **HTTP** it is strict: send `{"command":"bible_next"}` exactly. Adding a `value` key
> returns `422 Unprocessable Entity`, because these commands deserialize as argument-free
> variants. The same applies to `show` and `hide`.

## HTTP API Endpoints

The HTTP API provides additional endpoints for querying status.

### GET /api/v1/status

Returns current application status snapshot.

**Request:**
```bash
curl http://localhost:8080/api/v1/status
```

**Response:**
```json
{
  "on_air": true,
  "active_theme": "Classic Dark",
  "live_verse": "John 3:16",
  "queue_length": 12,
  "confidence_threshold": 0.75
}
```

### POST /api/v1/command

Executes a remote command (see Available Commands above).

**Request:**
```bash
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"next"}'
```

**Response:**
```json
{
  "success": true
}
```

A rejected command returns `500` with the reason attached:

```json
{
  "success": false,
  "error": "Unknown OSC address: /rhema/nope"
}
```

## Integration Examples

### Elgato Stream Deck (via Companion)

[Bitfocus Companion](https://bitfocus.io/companion) provides Stream Deck integration with OSC support.

1. **Install Companion** and configure your Stream Deck
2. **Add Generic OSC module**:
   - Host: `127.0.0.1` (or your Rhema computer's IP)
   - Port: `8000`
3. **Create buttons** for each command:
   - **Next in Queue**: OSC path `/rhema/next`
   - **Prev in Queue**: OSC path `/rhema/prev`
   - **Next Verse (Bible panel)**: OSC path `/rhema/bible_next`
   - **Prev Verse (Bible panel)**: OSC path `/rhema/bible_prev`
   - **Send to Live**: OSC path `/rhema/send_to_live`
   - **Add to Queue**: OSC path `/rhema/add_to_queue`
   - **Show Output**: OSC path `/rhema/show`
   - **Hide Output**: OSC path `/rhema/hide`
   - **Go Live**: OSC path `/rhema/on_air` with argument `true`

A useful three-button layout for reading through a passage the AI has not detected:
`bible_next` / `bible_prev` to move, `send_to_live` to push the verse you land on.

### TouchOSC / Lemur

Mobile control surfaces can send OSC commands directly.

**TouchOSC Example:**
1. Create buttons with OSC message type
2. Set destination to Rhema computer IP:8000
3. Configure OSC addresses:
   - `/rhema/next`
   - `/rhema/prev`
   - `/rhema/bible_next`
   - `/rhema/bible_prev`
   - `/rhema/send_to_live`
   - `/rhema/add_to_queue`
   - `/rhema/show`
   - `/rhema/hide`

### Node.js / JavaScript Automation

**Using HTTP API:**

```javascript
const RHEMA_URL = 'http://localhost:8080/api/v1';

async function nextVerse() {
  await fetch(`${RHEMA_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'next' })
  });
}

async function setTheme(themeName) {
  await fetch(`${RHEMA_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'theme', value: themeName })
  });
}

async function getStatus() {
  const res = await fetch(`${RHEMA_URL}/status`);
  return res.json();
}

// Usage
await nextVerse();
await setTheme('Minimal');
const status = await getStatus();
console.log(status);
```

**Using OSC (via `osc` npm package):**

```javascript
import { Client } from 'osc';

const osc = new Client('localhost', 8000);

// Send commands
osc.send('/rhema/next');
osc.send('/rhema/prev');
osc.send('/rhema/bible_next');
osc.send('/rhema/bible_prev');
osc.send('/rhema/send_to_live');
osc.send('/rhema/add_to_queue');
osc.send('/rhema/theme', 'Classic Dark');
osc.send('/rhema/opacity', 0.8);
osc.send('/rhema/on_air', true);
```

### Python Automation

**Using HTTP API:**

```python
import requests

RHEMA_URL = 'http://localhost:8080/api/v1'

def next_verse():
    requests.post(f'{RHEMA_URL}/command',
                  json={'command': 'next'})

def set_theme(theme_name):
    requests.post(f'{RHEMA_URL}/command',
                  json={'command': 'theme', 'value': theme_name})

def get_status():
    response = requests.get(f'{RHEMA_URL}/status')
    return response.json()

# Usage
next_verse()
set_theme('Minimal')
status = get_status()
print(status)
```

**Using OSC (via `python-osc` package):**

```python
from pythonosc import udp_client

osc = udp_client.SimpleUDPClient('localhost', 8000)

# Send commands
osc.send_message('/rhema/next', [])
osc.send_message('/rhema/prev', [])
osc.send_message('/rhema/bible_next', [])
osc.send_message('/rhema/bible_prev', [])
osc.send_message('/rhema/send_to_live', [])
osc.send_message('/rhema/add_to_queue', [])
osc.send_message('/rhema/theme', 'Classic Dark')
osc.send_message('/rhema/opacity', 0.8)
osc.send_message('/rhema/on_air', True)
```

### OBS Studio Integration

While Rhema uses NDI for video output, you can use remote control for automation:

**OBS Advanced Scene Switcher + Shell Command:**

```bash
#!/bin/bash
# next-verse.sh
curl -X POST http://localhost:8080/api/v1/command \
  -H "Content-Type: application/json" \
  -d '{"command":"next"}'
```

Configure OBS hotkeys or macros to trigger this script.

## Monitoring & Debugging

### Command Log

The Settings → Remote tab shows a real-time **Command Log** displaying:
- Timestamp of each received command
- Source (OSC or HTTP)
- Command type

Use this to verify your integration is working correctly.

### Troubleshooting

#### Commands Not Received

1. **Check Server Status**
   - Settings → Remote → Verify OSC/HTTP shows "Running"
   - Confirm correct port numbers

2. **Test Locally First**
   ```bash
   # Test HTTP locally
   curl -X POST http://localhost:8080/api/v1/command \
     -H "Content-Type: application/json" \
     -d '{"command":"next"}'
   ```

3. **Firewall Issues**
   - Allow incoming connections on OSC/HTTP ports
   - On macOS: System Preferences → Security & Privacy → Firewall

4. **Network Issues**
   - Verify computer IP address: `ifconfig` (macOS/Linux) or `ipconfig` (Windows)
   - Test connectivity: `ping <rhema-computer-ip>`
   - Ensure both devices on same network (if remote)

#### Port Already in Use

If you see "Port already in use" error:
- Change the port number in settings
- Check what's using the port: `lsof -i :8000` (macOS/Linux)
- Kill conflicting process or choose different port

#### OSC vs HTTP - Which to Use?

**Use OSC if:**
- Integrating with hardware controllers
- Using Companion, TouchOSC, QLab, etc.
- Need low-latency, fire-and-forget commands
- Already have OSC infrastructure

**Use HTTP if:**
- Building custom web dashboards
- Scripting automation tasks
- Need request/response confirmation
- Querying status information
- Prefer REST-style APIs

## Security Considerations

### Network Exposure

Both OSC and HTTP bind to `0.0.0.0`, so while a server is running it is reachable from any
device on your network. There is no authentication, and CORS allows any origin. **This is not
currently configurable from the app** — enabling a server exposes it to the whole network.

**`send_to_live` raises what that costs you.** Until now the worst an unauthenticated request
could do was advance the queue or toggle opacity. It can now put a verse of its choosing on
the Live output in front of the congregation. Treat an enabled remote-control server as an
open door to your broadcast.

**Until a loopback-by-default option ships:**
- Only enable the OSC and HTTP servers when you are actually using them
- Restrict the ports (default 8000/UDP and 8080/TCP) with firewall rules to the devices that
  need them
- Prefer a trusted, password-protected network over open guest Wi-Fi
- For remote access, use a VPN or SSH tunnel rather than exposing the ports directly

Binding to loopback by default, with network exposure as an explicit opt-in, is the next
change scheduled for this surface.

### Command Validation

All commands are validated before execution:
- Invalid JSON is rejected (HTTP)
- Unknown commands are ignored
- Parameter types are checked (float/string/bool)

## Technical Details

### OSC Implementation

- **Transport**: UDP
- **Library**: Custom parser built on `tokio` async runtime
- **Message Format**: Standard OSC bundle/message format
- **Address Pattern**: `/rhema/<command>`
- **Arguments**: Matched positionally to command parameters

### HTTP Implementation

- **Framework**: Axum (Rust async web framework)
- **Transport**: TCP with keep-alive
- **Content-Type**: `application/json`
- **CORS**: Permissive — any origin is allowed. A page open in a browser on the same machine or network can reach this API. See [Security Considerations](#security-considerations).

### Command Flow

1. **Receive**: OSC/HTTP listener receives command
2. **Parse**: Convert to unified `RemoteCommand` enum
3. **Validate**: Type-check parameters
4. **Dispatch**: Route to appropriate store action
5. **Execute**: Update application state
6. **Log**: Record in command log (if enabled)

### Status Sync

The HTTP status endpoint is updated every 1000ms (1 second) with a snapshot from the frontend:
- On-air state
- Active theme name
- Live verse reference
- Queue length
- Confidence threshold

This ensures the `/api/v1/status` endpoint always returns current data.

## Future Enhancements

Planned additions to remote control:

- **Loopback binding by default**, with network exposure as an explicit opt-in
- **Authentication** for HTTP API (API keys or OAuth)
- **WebSocket API** for real-time bidirectional communication
- **MIDI support** for hardware controllers with MIDI over USB
- **Custom command macros** (trigger multiple commands at once)
- **Verse navigation by reference** (e.g., `/rhema/goto John 3:16`)
- **Further queue management** — removing, reordering and clearing (adding is covered by `add_to_queue`)

## Support

For issues or questions:
- Check the main [README](../README.md)
- Consult [Whisper Documentation](./whisper.md) for transcription setup
- Report bugs on GitHub
- Check logs in Console.app (macOS) or terminal output

---

**Next Steps:**
- Learn about [Whisper Transcription](./whisper.md) for local speech-to-text
- See [README](../README.md) for general usage and setup
