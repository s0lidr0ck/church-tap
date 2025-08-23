# NFC Testing Guide

## The Problem
Chrome on Android requires HTTPS for NFC writing functionality. If you try to write NFC tags over HTTP, you'll get the error: **"nfc writing not supported on this device"**

## Solution: HTTPS Development Server

### Quick Start
1. **Start HTTPS development server:**
   ```bash
   npm run dev:https
   ```

2. **Access your site:**
   - On your computer: `https://localhost:3000`
   - On your Android device: `https://YOUR_COMPUTER_IP:3000` (e.g., `https://192.168.1.100:3000`)

3. **Accept the security warning:**
   - Your browser will show a security warning for the self-signed certificate
   - Click "Advanced" then "Proceed to localhost (unsafe)" or similar
   - This is safe for development

### Finding Your Computer's IP Address

**Windows:**
```bash
ipconfig | findstr IPv4
```

**Mac/Linux:**
```bash
ifconfig | grep inet
```

### NFC Testing Steps

1. **Access the master portal** over HTTPS
2. **Navigate to NFC Tags section**
3. **Create and assign an NFC tag** to an organization
4. **Click "Write" button** on an assigned tag
5. **Hold your Android device** near the NFC tag when prompted
6. **The tag should be written** with the organization's URL

### Requirements for NFC Writing

- ✅ **HTTPS** - Required for Chrome Android
- ✅ **Chrome browser** on Android
- ✅ **NFC enabled** on the device
- ✅ **User gesture** - Must be triggered by a button click
- ✅ **Physical NFC tag** - Must be within range of the device

### Troubleshooting

**Still getting "not supported" error?**
- Ensure you're using HTTPS (lock icon in address bar)
- Try a different Chrome version
- Check that NFC is enabled in Android settings
- Verify the tag is within range of your device's NFC reader

**Certificate errors?**
- The self-signed certificate is expected in development
- Click "Advanced" and "Proceed" to continue
- For production, use a proper SSL certificate

### Development vs Production

**Development (this setup):**
- Uses self-signed certificates
- HTTPS on port 3000
- Requires accepting security warnings

**Production:**
- Should use proper SSL certificates (Let's Encrypt, etc.)
- Standard HTTPS port 443
- No security warnings

## Technical Details

The NFC Web API requires:
1. **Secure Context** (HTTPS)
2. **User Activation** (user gesture like button click)
3. **Browser Support** (Chrome 89+ on Android)
4. **NFC Permission** (granted automatically on user gesture)

For more info, see: [Web NFC API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API)