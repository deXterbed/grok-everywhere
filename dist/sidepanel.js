document.addEventListener('DOMContentLoaded', async () => {
    const messageInput = document.getElementById('message-input');
    const chatContainer = document.getElementById('chat-container');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyButton = document.getElementById('save-api-key');
    const imageButton = document.querySelector('.image-button');
    let apiKey = null;
    let currentScreenshot = null;
    let autoImageMode = true;  // Set to true by default
    let isShortcutMode = false;
    let lastAutoScreenshot = null; // Track auto mode screenshot separately
    let port = null; // Store port at module level

    // Load API key
    const result = await chrome.storage.local.get(['xaiApiKey']);
    apiKey = result.xaiApiKey;
    
    if (apiKey) {
        apiKeyInput.value = 'API key saved';
        apiKeyInput.classList.add('saved');
        saveApiKeyButton.classList.add('active');
        messageInput.disabled = false;
    } else {
        messageInput.disabled = true;
    }

    // Handle API key input and save
    apiKeyInput.addEventListener('focus', () => {
        if (apiKey && apiKeyInput.classList.contains('saved')) {
            apiKeyInput.value = apiKey;
        }
    });

    apiKeyInput.addEventListener('blur', () => {
        if (apiKey && apiKeyInput.classList.contains('saved')) {
            apiKeyInput.value = 'API key saved';
        }
    });

    apiKeyInput.addEventListener('input', async () => {
        const newValue = apiKeyInput.value.trim();
        
        if (apiKeyInput.classList.contains('saved')) {
            apiKeyInput.classList.remove('saved');
            saveApiKeyButton.classList.remove('active');
        }

        // If the input is empty, remove the API key from storage
        if (!newValue) {
            await chrome.storage.local.remove('xaiApiKey');
            apiKey = null;
        }

        messageInput.disabled = !newValue;
    });

    saveApiKeyButton.addEventListener('click', async () => {
        if (saveApiKeyButton.classList.contains('active')) {
            // If button is active, clicking it should delete the API key
            await chrome.storage.local.remove('xaiApiKey');
            apiKey = null;
            apiKeyInput.value = '';
            apiKeyInput.classList.remove('saved');
            saveApiKeyButton.classList.remove('active');
            messageInput.disabled = true;
        } else {
            // If button is not active, save the new API key
            const newApiKey = apiKeyInput.value.trim();
            if (newApiKey) {
                await chrome.storage.local.set({ xaiApiKey: newApiKey });
                apiKey = newApiKey;
                apiKeyInput.value = 'API key saved';
                apiKeyInput.classList.add('saved');
                saveApiKeyButton.classList.add('active');
                messageInput.disabled = false;
            }
        }
    });

    // Set image button as active by default since auto mode is enabled
    imageButton.classList.add('active');
    // Set initial placeholder text
    messageInput.placeholder = 'Ask anything (with context)';

    // Connect to the background script and handle reconnection
    function connectToBackground() {
        if (port) {
            try {
                port.disconnect();
            } catch (e) {
                console.error('Error disconnecting port:', e);
            }
        }
        
        port = chrome.runtime.connect({ name: 'sidepanel' });
        
        port.onMessage.addListener((message) => {
            if (message.action === 'clearConversation') {
                clearConversation();
            }
        });
        
        port.onDisconnect.addListener(() => {
            port = null;
            console.log('Disconnected from background, attempting to reconnect...');
            setTimeout(connectToBackground, 1000);
        });
    }
    
    // Initial connection
    connectToBackground();

    // Keep track of conversation history
    let conversationHistory = [];

    // Load previous conversation if it exists
    chrome.storage.local.get(['conversationHistory'], (result) => {
        if (result.conversationHistory) {
            conversationHistory = result.conversationHistory;
            // Restore the conversation UI
            conversationHistory.forEach(msg => {
                addMessage(msg.content, msg.isUser, msg.screenshot);
            });
        }
    });

    function clearConversation() {
        conversationHistory = [];
        chrome.storage.local.set({ conversationHistory: [] });
        chatContainer.innerHTML = '';
        messageInput.value = '';
        messageInput.focus();
    }

    async function takeScreenshot() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'captureTab' }, resolve);
            });
            return response?.dataUrl || null;
        } catch (error) {
            console.error('Failed to take screenshot:', error);
            return null;
        }
    }

    function clearShortcutMode() {
        isShortcutMode = false;
        currentScreenshot = null;
        imageButton.classList.remove('active');
    }

    function clearAutoMode() {
        autoImageMode = false;
        lastAutoScreenshot = null;
        imageButton.classList.remove('active');
    }

    // Image button toggle functionality
    imageButton.addEventListener('click', () => {
        if (autoImageMode) {
            // Turning off auto mode
            clearAutoMode();
            imageButton.classList.remove('active');
            messageInput.placeholder = 'Ask anything';
        } else if (isShortcutMode) {
            // Cancel shortcut mode
            clearShortcutMode();
        } else {
            // Turn on auto mode
            autoImageMode = true;
            isShortcutMode = false;
            imageButton.classList.add('active');
            messageInput.placeholder = 'Ask anything (with context)';
        }
    });

    // Function to handle message sending
    async function handleMessageSend() {
        const message = messageInput.value.trim();
        if (message) {
            messageInput.value = '';
            
            let screenshotToSend = null;
            let wasShortcutMode = isShortcutMode;
            
            if (autoImageMode) {
                // Auto mode: take new screenshot
                screenshotToSend = await takeScreenshot();
                lastAutoScreenshot = screenshotToSend;
            } else if (isShortcutMode && currentScreenshot) {
                // Shortcut mode: use existing screenshot once
                screenshotToSend = currentScreenshot;
                // Clear shortcut mode immediately
                clearShortcutMode();
            }
            
            try {
                await sendMessage(message, screenshotToSend);
            } catch (error) {
                // If sending fails and we were in shortcut mode, restore the screenshot
                if (wasShortcutMode && screenshotToSend) {
                    currentScreenshot = screenshotToSend;
                    isShortcutMode = true;
                    imageButton.classList.add('active');
                }
                throw error;
            } finally {
                messageInput.focus();
            }
        }
    }

    // Handle Enter key press
    messageInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await handleMessageSend();
        }
    });

    // Handle send button click
    const sendButton = document.querySelector('.send-button');
    sendButton.addEventListener('click', handleMessageSend);

    // Listen for screenshot messages (from shortcut)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'addScreenshotContext') {
            if (!autoImageMode) {
                // Clear any existing shortcut screenshot
                clearShortcutMode();
                // Set new screenshot
                currentScreenshot = request.dataUrl;
                isShortcutMode = true;
                imageButton.classList.add('active');
            }
            messageInput.focus();
        }
    });

    async function sendMessage(message, screenshot = null) {
        // Add message to UI first
        addMessage(message, true, screenshot);
        
        // Add to conversation history
        conversationHistory.push({
            content: message,
            isUser: true,
            screenshot: screenshot
        });
        await chrome.storage.local.set({ conversationHistory });

        // Get reply
        const reply = await fetchReply(message, screenshot);
        
        // Add reply to conversation history
        conversationHistory.push({
            content: reply,
            isUser: false
        });
        await chrome.storage.local.set({ conversationHistory });

        // Add reply to UI
        addMessage(reply, false);
    }

    async function fetchReply(message, screenshot) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: 'You are Grok, a helpful AI assistant created by xAI.'
                }
            ];
            
            if (screenshot) {
                messages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'This is a screenshot of my current browser view:'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: screenshot
                            }
                        }
                    ]
                });
            }
            
            messages.push({
                role: 'user',
                content: [{
                    type: 'text',
                    text: message
                }]
            });

            const response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'grok-2-vision-1212',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 4096
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                let errorMessage;
                try {
                    const errorJson = JSON.parse(errorData);
                    errorMessage = errorJson.error?.message || 'API request failed';
                } catch {
                    errorMessage = errorData || `API request failed with status ${response.status}`;
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('Invalid response format from API');
            }

            return data.choices[0].message.content;
        } catch (error) {
            const errorMessage = error.message || 'An unknown error occurred';
            addMessage(`Error: ${errorMessage}`, false);
            throw error;
        }
    }

    function addMessage(content, isUser, screenshot = null) {
        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = `message-wrapper${isUser ? ' user' : ''}`;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';

        // Avatar removed for Grok-like UI

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Create text content
        const textSpan = document.createElement('span');
        textSpan.textContent = content;
        contentDiv.appendChild(textSpan);

        // Add small inline image if screenshot exists
        if (screenshot) {
            const img = document.createElement('img');
            img.src = screenshot;
            img.style.height = '1.2em'; // Match line height
            img.style.width = 'auto';
            img.style.verticalAlign = 'middle';
            img.style.marginLeft = '0.5em';
            img.style.display = 'inline-block';
            img.style.borderRadius = '4px'; // More rounded corners
            img.style.border = '4px solid #BCDCF5'; // 4px thick border
            contentDiv.appendChild(img);
        }

        messageDiv.appendChild(contentDiv);
        wrapperDiv.appendChild(messageDiv);
        chatContainer.appendChild(wrapperDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});
