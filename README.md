# Echo360 Speed Control - Faster Lectures

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-green)](https://chrome.google.com/webstore)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/echo360-speed-control/releases)

The majority of Australian universities use Echo360 for lecture recordings, and have aggressive prevention systems for speed control blockers, so I made a Chrome extension that bypasses it.

## Chrome Web Store

Coming soon!

## 🎮 Usage

### Method 1: Player Menu

1. Click the playback speed button in the Echo360 player
2. Select from the extended range of speeds (now including 2.25x, 2.5x, 2.75x, and 3x)
3. Speeds above 2x are marked with a ⚡ lightning bolt

### Method 2: Extension Popup

1. Click the extension icon in your Chrome toolbar
2. Use the slider or preset buttons to select your desired speed
3. The player updates immediately

## 🛠️ Technical Details

The extension works by:

1. Injecting a script that overrides the native `playbackRate` property
2. Intercepting and blocking Echo360's speed reset attempts
3. Modifying the player UI to include additional speed options
4. Using message passing to avoid Content Security Policy restrictions

### File Structure

- **manifest.json** - Extension configuration
- **content.js** - Runs in isolated context, handles messaging
- **injector-simple.js** - Runs in page context, overrides native APIs
- **popup.html/js** - User interface for speed control

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## ⚠️ Disclaimer

This extension is not affiliated with Echo360. Obviously.

## 📧 Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/WeiChongDevelops/echo360-speed-control/issues) on GitHub.

Built with 💚 for efficient learning
