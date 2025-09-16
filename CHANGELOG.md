# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2024-12-19

### Added
- **Markdown Rendering**: Complete markdown support for Grok responses including headers, code blocks, lists, links, and formatting
- **Smart Auto-scroll**: Intelligent scroll behavior that respects user reading position while maintaining auto-scroll for new content
- **Enhanced Code Block Support**: Proper syntax highlighting and language detection for code blocks
- **Word Wrapping**: Comprehensive text wrapping to prevent content truncation

### Changed
- **Improved Message Display**: Messages now render with proper HTML formatting instead of plain text
- **Better Scroll Behavior**: Auto-scroll only occurs when user is at bottom and hasn't manually scrolled up
- **Enhanced CSS**: Improved styling for all markdown elements with proper spacing and typography

### Fixed
- **Content Truncation**: Long text and code now wraps properly instead of being cut off
- **Code Block Parsing**: Language identifiers are properly handled and not displayed as text
- **Header Rendering**: Markdown headers (####, ###, etc.) are now properly rendered as HTML elements
- **List Formatting**: Bullet points and numbered lists display correctly with proper indentation

### Technical Improvements
- **Enhanced Markdown Parser**: Line-by-line processing for better accuracy and proper element handling
- **Scroll Position Tracking**: Smart detection of user scroll behavior to provide non-intrusive auto-scroll
- **CSS Optimization**: Added comprehensive word wrapping and box-sizing rules for better text flow
- **Code Quality**: Improved code formatting and consistency throughout the codebase

---

## [1.0.2] - Previous Version
- Base functionality with plain text message display
- Basic auto-scroll behavior
- Screenshot and content extraction features
