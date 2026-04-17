# Security Policy

## Content Security Policy (CSP)

This application implements a restrictive Content Security Policy to protect against script injection attacks and unauthorized data exfiltration.

### Current CSP Configuration

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' wss://api.deepgram.com https://api.deepgram.com;
media-src 'self' blob:;
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
```

### Policy Breakdown

#### `default-src 'self'`
All resources default to same-origin only. This is the foundation of the security policy.

#### `script-src 'self'`
**Scripts must be from the app bundle only.**
- ✅ Prevents inline script injection
- ✅ Blocks external script loading
- ✅ Protects against XSS attacks

#### `style-src 'self' 'unsafe-inline'`
**Styles from app bundle or inline.**
- ⚠️ `'unsafe-inline'` required for:
  - Tailwind CSS utility classes
  - shadcn/ui component styles
  - Dynamic theme styling
- ✅ Still blocks external stylesheet loading

#### `img-src 'self' data: blob: https:`
**Images from multiple sources (controlled risk).**
- `'self'` - App bundle images
- `data:` - Base64-encoded images (safe, inline data)
- `blob:` - Canvas-generated images for broadcast output
- `https:` - **User-supplied theme background images**

**Security Note:** This is the primary attack surface. Users can set arbitrary HTTPS URLs as theme background images. However:
1. Only HTTPS allowed (no HTTP)
2. No JavaScript execution from images
3. No script-src allows inline scripts
4. Images are sandboxed in Tauri webview

**Mitigation:** Theme background images are validated and rendered in an isolated context (broadcast output window).

#### `font-src 'self' data:`
**Fonts from app bundle or data URIs.**
- ✅ Blocks external font loading
- ✅ `data:` allows embedded font resources

#### `connect-src 'self' wss://api.deepgram.com https://api.deepgram.com`
**Network connections strictly whitelisted.**
- `'self'` - Local Tauri commands and IPC
- `wss://api.deepgram.com` - Deepgram WebSocket for STT
- `https://api.deepgram.com` - Deepgram HTTPS API

**Explicitly Blocked:**
- ❌ OpenAI API (not currently used)
- ❌ Anthropic API (not currently used)
- ❌ Any other external services

**Note:** If OpenAI or Anthropic APIs are added in the future, update CSP to:
```
connect-src 'self' wss://api.deepgram.com https://api.deepgram.com https://api.openai.com https://api.anthropic.com;
```

#### `media-src 'self' blob:`
**Media from app bundle or blob URLs.**
- `'self'` - App audio files
- `blob:` - Audio recording and playback

#### `frame-src 'none'`
**Frames/iframes completely blocked.**
- ✅ Prevents clickjacking
- ✅ Prevents embedded malicious content

#### `object-src 'none'`
**Object/embed/applet tags blocked.**
- ✅ No Flash or legacy plugins
- ✅ No object-based injections

#### `base-uri 'self'`
**Base tag restricted to same-origin.**
- ✅ Prevents base tag hijacking

#### `form-action 'self'`
**Forms can only submit to same-origin.**
- ✅ Prevents form submission to external sites
- ✅ Protects against CSRF

## Threat Model

### Protected Against

✅ **Script Injection (XSS)**
- `script-src 'self'` prevents inline and external scripts
- Even if user input is reflected in HTML, scripts cannot execute

✅ **Clickjacking**
- `frame-src 'none'` prevents embedding in iframes

✅ **Data Exfiltration via Scripts**
- No external script loading means no attacker-controlled code

✅ **Unauthorized API Connections**
- `connect-src` whitelist blocks connections to unknown origins

✅ **CSRF Attacks**
- `form-action 'self'` prevents form submissions to external sites

### Residual Risks

⚠️ **Theme Background Image URLs**
- Users can set HTTPS URLs for theme backgrounds
- **Risk Level:** Low
- **Reason:** Images cannot execute JavaScript
- **Mitigation:**
  - Only HTTPS allowed
  - Rendered in isolated broadcast window
  - No `script-src` allows code execution from images

⚠️ **Inline Styles (`unsafe-inline`)**
- Required for Tailwind and shadcn/ui
- **Risk Level:** Very Low
- **Reason:** Styles cannot execute code
- **Note:** CSS injection attacks are limited without script execution

## Security Best Practices

### For Developers

1. **Never add `'unsafe-eval'` to `script-src`**
   - This would allow `eval()` and `Function()` constructors
   - Defeats most XSS protections

2. **Validate user input on the backend (Rust)**
   - Don't rely solely on CSP for input validation
   - Sanitize and validate all user-supplied data

3. **Keep external API whitelist minimal**
   - Only add APIs that are actively used
   - Remove APIs when features are deprecated

4. **Test CSP violations**
   - Monitor browser console for CSP violations during development
   - Fix violations rather than loosening policy

### For Theme Developers

1. **Use trusted image sources**
   - Prefer local images (`file://` or data URIs)
   - Use reputable HTTPS image hosts if external images needed

2. **Avoid SVG images with embedded scripts**
   - SVG can contain `<script>` tags
   - CSP blocks script execution, but avoid as defense-in-depth

## CSP Violation Reporting

CSP violations appear in the browser console during development:

```
Refused to load <resource> because it violates the following Content Security Policy directive: <directive>
```

### Common Violations and Fixes

#### ❌ External script blocked
```
Refused to load script from 'https://evil.com/script.js' because it violates CSP directive: script-src 'self'
```
**Fix:** Remove external script or bundle it locally.

#### ❌ Inline event handler blocked
```
Refused to execute inline event handler because it violates CSP directive: script-src 'self'
```
**Fix:** Use `addEventListener()` in a separate `.ts` file instead of `onclick=""`.

#### ❌ External API connection blocked
```
Refused to connect to 'https://unknown-api.com' because it violates CSP directive: connect-src ...
```
**Fix:** Add the API to `connect-src` whitelist if it's a legitimate service.

## Future Enhancements

### Potential Improvements

1. **Image URL Validation**
   - Add backend validation for theme background image URLs
   - Restrict to specific domains or patterns

2. **Remove `'unsafe-inline'` from `style-src`**
   - Possible if Tailwind uses nonce or hash-based CSP
   - Would require build-time style extraction

3. **Add CSP Reporting**
   - Configure `report-uri` or `report-to` directive
   - Log CSP violations to backend for monitoring

4. **Subresource Integrity (SRI)**
   - Add integrity hashes for critical resources
   - Further prevents tampering

## Testing

### Manual CSP Verification

1. **Open DevTools Console**
2. **Trigger each app feature:**
   - Theme designer with background images
   - Voice transcription (Deepgram connection)
   - Broadcast output window
3. **Check for CSP violations**
   - Should see zero violations under normal operation

### Automated Testing

```bash
# Check CSP configuration
cat src-tauri/tauri.conf.json | jq '.app.security.csp'

# Build and run
bun run tauri dev

# Monitor console for violations
```

## Reporting Security Issues

If you discover a security vulnerability, please email security@openbezal.com instead of opening a public issue.

**Do NOT:**
- Open public GitHub issues for security vulnerabilities
- Disclose vulnerabilities publicly before a fix is available

**DO:**
- Provide detailed reproduction steps
- Include proof-of-concept (if applicable)
- Allow time for a fix before public disclosure

## References

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP: CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [Tauri Security Best Practices](https://tauri.app/v1/references/architecture/security/)
