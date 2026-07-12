/**
 * Context Image Generation 🍌
 * Gemini-powered image generation with avatar references and character context
 * Uses SillyTavern's backend to handle Google AI authentication
 * Version 1.3.3
 */

import {
    saveSettingsDebounced,
    getRequestHeaders,
    appendMediaToMessage,
    eventSource,
    event_types,
    saveChatConditional,
    user_avatar,
    getUserAvatar as getAvatarPath,
    name1,
} from '../../../../script.js';

import { getContext, extension_settings } from '../../../extensions.js';
import { getBase64Async, saveBase64AsFile } from '../../../utils.js';
import { power_user } from '../../../power-user.js';
import { oai_settings } from '../../../openai.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

const extensionName = 'context-image-generation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Provider-specific model configurations
const PROVIDER_MODELS = {
    makersuite: {
        flash: { id: 'gemini-2.5-flash-image', name: 'Nano Banana 🍌 (~$0.04/img)' },
        flash2: { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2 🍌 (Flash)' },
        pro: { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro 🍌 (~$0.14/img)' },
    },
    linkapi: {
        flash: { id: 'gemini-2.5-flash-image', name: 'Nano Banana 🍌 (LinkAPI)' },
        flash2: { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2 🍌 (LinkAPI)' },
        pro: { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro 🍌 (LinkAPI)' },
        gptimage: { id: 'gpt-image-2-c', name: 'ChatGPT Image 🖼️ (gpt-image-2-c)' },
    },
    openrouter: {
        flash: { id: 'google/gemini-2.5-flash-image-preview', name: 'Nano Banana 🍌 (OpenRouter)' },
        flash2: { id: 'google/gemini-3.1-flash-image-preview', name: 'Nano Banana 2 🍌 (OpenRouter)' },
        pro: { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro 🍌 (OpenRouter)' },
    },
};

const defaultSettings = {
    provider: 'makersuite',
    model: 'gemini-2.5-flash-image',
    linkapi_key: '',
    aspect_ratio: '1:1',
    image_size: '',
    thinking_level: 'auto',
    use_google_search: false,
    auto_generate: 'off',
    use_avatars: false,
    include_descriptions: false,
    use_previous_image: false,
    message_depth: 1,
    system_instruction: 'You are an image generation assistant. When reference images are provided, they represent the characters in the story. Generate an illustration that depicts the scene described in the prompt while maintaining the art style and appearance of the reference characters. You are not obligated to include both characters - if the scene depicts only one character alone, illustrate them alone. When available, you can use the internet to search for reference pictures and information to improve the accuracy and quality of your generations.',
    gallery: [],
};

const MAX_GALLERY_SIZE = 50;

// Runtime-only list of image models fetched from LinkAPI /v1/models (not persisted).
let fetchedLinkApiModels = [];

// --- LinkAPI ChatGPT (gpt-image) helpers (pure, text-prompt only) ---

function isOpenAiImageModel(model) {
    return /^(gpt-image|dall-e)/i.test(model || '');
}

function mapAspectRatioToSize(aspectRatio) {
    switch (aspectRatio) {
        case '3:4':
        case '9:16':
            return '1024x1536';
        case '4:3':
        case '16:9':
            return '1536x1024';
        case '1:1':
        default:
            return '1024x1024';
    }
}

function extractPromptText(messages) {
    const parts = [];
    for (const msg of messages || []) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && part.type === 'text' && part.text) {
                    parts.push(part.text);
                }
            }
        } else if (typeof msg.content === 'string' && msg.content) {
            parts.push(msg.content);
        }
    }
    return parts.join('\n\n');
}

function parseImagesResponse(json) {
    const item = json && Array.isArray(json.data) ? json.data[0] : null;
    return { b64: (item && item.b64_json) || null, url: (item && item.url) || null };
}

function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function requestLinkApiImage({ apiKey, model, prompt, size, host = 'https://linkapi.ai' }) {
    const response = await fetch(`${host}/v1/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] LinkAPI image error:`, errorText);
        let message = `API Error: ${response.status}`;
        try {
            const j = JSON.parse(errorText);
            message = j.error?.message || j.message || message;
        } catch (e) { /* keep default */ }
        throw new Error(message);
    }

    const json = await response.json();
    const { b64, url } = parseImagesResponse(json);
    if (b64) {
        return { imageData: b64, mimeType: 'image/png' };
    }
    if (url) {
        const imgResp = await fetch(url);
        const buf = await imgResp.arrayBuffer();
        return { imageData: arrayBufferToBase64(buf), mimeType: 'image/png' };
    }
    throw new Error('No image was returned by the API');
}

// Dev aid: reach the pure helpers from the DevTools console for verification.
window.cigDebug = Object.assign(window.cigDebug || {}, {
    isOpenAiImageModel,
    mapAspectRatioToSize,
    extractPromptText,
    parseImagesResponse,
    requestLinkApiImage,
});

function updateModelDropdown() {
    const settings = extension_settings[extensionName];
    const provider = settings.provider || 'makersuite';
    const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.makersuite;

    const $modelSelect = $('#cig_model');
    $modelSelect.empty();

    for (const m of Object.values(models)) {
        $modelSelect.append(`<option value="${m.id}">${m.name}</option>`);
    }

    // Merge dynamically fetched LinkAPI image models (runtime only).
    if (provider === 'linkapi' && Array.isArray(fetchedLinkApiModels)) {
        for (const m of fetchedLinkApiModels) {
            if (!$modelSelect.find(`option[value="${m.id}"]`).length) {
                $modelSelect.append(`<option value="${m.id}">${m.name}</option>`);
            }
        }
    }

    // Keep the exact current model if it is still available; otherwise fall back
    // to the closest type match (preserves cross-provider switching behaviour).
    const optionValues = $modelSelect.find('option').map((i, o) => o.value).get();
    const currentModel = settings.model || '';
    if (optionValues.includes(currentModel)) {
        $modelSelect.val(currentModel);
    } else if (currentModel.includes('pro') || currentModel.includes('3-pro')) {
        $modelSelect.val(models.pro.id);
        settings.model = models.pro.id;
    } else if (currentModel.includes('3.1') || currentModel.includes('3-1')) {
        $modelSelect.val(models.flash2.id);
        settings.model = models.flash2.id;
    } else {
        $modelSelect.val(models.flash.id);
        settings.model = models.flash.id;
    }

    if (typeof toggleImageSizeVisibility === 'function') {
        toggleImageSizeVisibility();
    }
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }

    $('#cig_provider').val(extension_settings[extensionName].provider);
    updateModelDropdown();
    $('#cig_model').val(extension_settings[extensionName].model);
    $('#cig_linkapi_key').val(extension_settings[extensionName].linkapi_key);
    $('#cig_aspect_ratio').val(extension_settings[extensionName].aspect_ratio);
    $('#cig_image_size').val(extension_settings[extensionName].image_size);
    $('#cig_thinking_level').val(extension_settings[extensionName].thinking_level);
    $('#cig_use_google_search').prop('checked', extension_settings[extensionName].use_google_search);
    $('#cig_use_avatars').prop('checked', extension_settings[extensionName].use_avatars);
    $('#cig_include_descriptions').prop('checked', extension_settings[extensionName].include_descriptions);
    $('#cig_use_previous_image').prop('checked', extension_settings[extensionName].use_previous_image);
    $('#cig_auto_generate').val(extension_settings[extensionName].auto_generate);
    $('#cig_message_depth').val(extension_settings[extensionName].message_depth);
    $('#cig_system_instruction').val(extension_settings[extensionName].system_instruction);

    toggleImageSizeVisibility();
    toggleProviderSpecificSettings();
    renderGallery();
}

function toggleProviderSpecificSettings() {
    const provider = extension_settings[extensionName].provider || 'makersuite';
    $('#cig_linkapi_container').toggle(provider === 'linkapi');
}

function toggleImageSizeVisibility() {
    const model = extension_settings[extensionName].model;
    const isProModel = /gemini-3-pro/.test(model);
    const isFlash2Model = /gemini-3\.1/.test(model);
    const isSizeSupported = isProModel || isFlash2Model;
    $('#cig_image_size_container').toggle(isSizeSupported);
    $('#cig_flash2_options').toggle(isFlash2Model);

    if (isSizeSupported) {
        updateSizeDropdown(model, isFlash2Model);
    }
}

function updateSizeDropdown(model, isFlash2Model) {
    const $sizeSelect = $('#cig_image_size');
    const currentValue = extension_settings[extensionName].image_size || '';

    $sizeSelect.empty();
    $sizeSelect.append('<option value="">Default</option>');

    if (isFlash2Model) {
        $('#cig_image_size_label').text('Image Size (Flash 2)');
        $sizeSelect.append('<option value="512">512px</option>');
        $sizeSelect.append('<option value="1K">1K</option>');
        $sizeSelect.append('<option value="2K">2K</option>');
        $sizeSelect.append('<option value="4K">4K</option>');
    } else {
        $('#cig_image_size_label').text('Image Size (Pro only)');
        $sizeSelect.append('<option value="1K">1K</option>');
        $sizeSelect.append('<option value="2K">2K</option>');
        $sizeSelect.append('<option value="4K">4K</option>');
    }

    // Select previous if exists, otherwise Default
    if ($sizeSelect.find(`option[value="${currentValue}"]`).length > 0) {
        $sizeSelect.val(currentValue);
    } else {
        $sizeSelect.val('');
        extension_settings[extensionName].image_size = '';
    }
}

async function getUserAvatar() {
    try {
        let avatarUrl = getAvatarPath(user_avatar);
        if (!avatarUrl) return null;

        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';
        const data = parts[1] || base64;
        const userName = name1 || 'User';

        return { mimeType, data, role: 'user', name: userName };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching user avatar:`, error);
        return null;
    }
}

async function getCharacterAvatar() {
    const context = getContext();
    const character = context.characters[context.characterId];
    if (!character?.avatar) return null;

    try {
        const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';

        return {
            mimeType,
            data: parts[1] || base64,
            role: 'character',
            name: context.name2 || 'Character',
        };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching character avatar:`, error);
        return null;
    }
}

function getRecentMessages(depth, fromMessageId = null) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return [];

    const messages = [];
    const startIndex = fromMessageId !== null ? fromMessageId : chat.length - 1;

    for (let i = startIndex; i >= 0 && messages.length < depth; i--) {
        const message = chat[i];
        if (message.mes && !message.is_system) {
            const charName = context.name2 || 'Character';
            const userName = name1 || 'User';
            messages.push({
                text: message.mes,
                isUser: message.is_user,
                name: message.is_user ? userName : charName,
            });
        }
    }

    return messages.reverse();
}

function getCharacterDescriptions() {
    const context = getContext();
    const character = context.characters[context.characterId];
    const userName = name1 || context.name1 || 'User';

    return {
        user_name: userName,
        user_persona: power_user.persona_description || '',
        char_name: context.name2 || 'Character',
        char_description: character?.description || '',
        char_scenario: character?.scenario || '',
    };
}

async function buildMessages(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    const messages = [];
    const contentParts = [];

    if (settings.system_instruction) {
        contentParts.push({ type: 'text', text: settings.system_instruction });
    }

    if (settings.include_descriptions) {
        const descriptions = getCharacterDescriptions();
        let descText = '';
        if (descriptions.user_persona) {
            descText += `[${descriptions.user_name} (User) Description]: ${descriptions.user_persona}\n\n`;
        }
        if (descriptions.char_description) {
            descText += `[${descriptions.char_name} (Character) Description]: ${descriptions.char_description}\n\n`;
        }
        if (descriptions.char_scenario) {
            descText += `[Current Scenario]: ${descriptions.char_scenario}\n\n`;
        }
        if (descText) {
            contentParts.push({ type: 'text', text: descText.trim() });
        }
    }

    const depth = settings.message_depth || 1;

    if (messageId !== null || sender !== null) {
        const recentMessages = getRecentMessages(depth, messageId);

        if (recentMessages.length > 0) {
            let storyContext = '[Story Context - Generate an image for the final message]:\n\n';

            for (const msg of recentMessages) {
                const senderTag = msg.isUser ? '{{user}}' : '{{char}}';
                storyContext += `[${senderTag} (${msg.name})]: ${msg.text}\n\n`;
            }

            contentParts.push({ type: 'text', text: storyContext.trim() });
        } else {
            if (sender) {
                contentParts.push({ type: 'text', text: `[Message from ${sender}]: ${prompt}` });
            } else {
                contentParts.push({ type: 'text', text: prompt });
            }
        }
    } else {
        contentParts.push({ type: 'text', text: prompt });
    }

    if (settings.use_previous_image && settings.gallery && settings.gallery.length > 0) {
        const lastImage = settings.gallery[0];
        console.log(`[${extensionName}] Adding previous generated image as reference`);
        contentParts.push({ type: 'text', text: '[Reference: Previously generated image for style consistency]' });
        contentParts.push({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${lastImage.imageData}` },
        });
    }

    if (settings.use_avatars) {
        const userAvatarData = await getUserAvatar();
        const charAvatarData = await getCharacterAvatar();

        if (charAvatarData) {
            console.log(`[${extensionName}] Adding character avatar for: ${charAvatarData.name}`);
            contentParts.push({ type: 'text', text: `[Reference image for {{char}}]` });
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${charAvatarData.mimeType};base64,${charAvatarData.data}` },
            });
        }

        if (userAvatarData) {
            console.log(`[${extensionName}] Adding user avatar for: ${userAvatarData.name}`);
            contentParts.push({ type: 'text', text: `[Reference image for {{user}}]` });
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${userAvatarData.mimeType};base64,${userAvatarData.data}` },
            });
        }
    }

    messages.push({ role: 'user', content: contentParts });
    return messages;
}

async function generateImageFromPrompt(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    const messages = await buildMessages(prompt, sender, messageId);

    const isFlash2 = /gemini-3\.1/.test(settings.model);
    const selectedProvider = settings.provider || 'makersuite';
    const isLinkApi = selectedProvider === 'linkapi';

    // ChatGPT (gpt-image) via LinkAPI: direct fetch, text prompt only.
    if (isLinkApi && isOpenAiImageModel(settings.model)) {
        console.log(`[${extensionName}] Generating via LinkAPI images endpoint, model:`, settings.model);
        return await requestLinkApiImage({
            apiKey: settings.linkapi_key,
            model: settings.model,
            prompt: extractPromptText(messages),
            size: mapAspectRatioToSize(settings.aspect_ratio),
        });
    }

    const requestBody = {
        chat_completion_source: isLinkApi ? 'makersuite' : selectedProvider,
        model: settings.model,
        messages: messages,
        max_tokens: 8192,
        temperature: 1,
        request_images: true,
        request_image_aspect_ratio: settings.aspect_ratio || '1:1',
        request_image_resolution: settings.image_size || undefined,
        stream: false,
        // LinkAPI uses the Gemini-compatible proxy endpoint without changing the active ST chat profile.
        reverse_proxy: isLinkApi ? 'https://api.linkapi.ai' : oai_settings.reverse_proxy || '',
        proxy_password: isLinkApi ? settings.linkapi_key || '' : oai_settings.proxy_password || '',
    };

    // Flash 2 specific options
    if (isFlash2) {
        const thinkingLevel = settings.thinking_level || 'auto';
        if (thinkingLevel !== 'auto') {
            requestBody.reasoning_effort = thinkingLevel;
        }
        if (settings.use_google_search) {
            requestBody.enable_web_search = true;
        }
    }

    console.log(`[${extensionName}] Generating image with provider: ${settings.provider}, model:`, settings.model);

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] API Error Response:`, errorText);
        let errorMessage = `API Error: ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (e) { }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    const responseContent = result.responseContent;

    if (responseContent?.parts) {
        for (const part of responseContent.parts) {
            if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return { imageData: part.inlineData.data, mimeType: mimeType };
            }
        }
    }

    const textContent = result.choices?.[0]?.message?.content;
    if (textContent) {
        console.log(`[${extensionName}] Text response received:`, textContent);
        throw new Error('Model returned text instead of image');
    }

    throw new Error('No image was returned by the API');
}

function addToGallery(imageData, prompt, messageId = null) {
    const settings = extension_settings[extensionName];

    if (!settings.gallery) {
        settings.gallery = [];
    }

    settings.gallery.unshift({
        imageData: imageData,
        prompt: prompt.substring(0, 200),
        timestamp: Date.now(),
        messageId: messageId,
    });

    if (settings.gallery.length > MAX_GALLERY_SIZE) {
        settings.gallery = settings.gallery.slice(0, MAX_GALLERY_SIZE);
    }

    saveSettingsDebounced();
    renderGallery();
}

function renderGallery() {
    const settings = extension_settings[extensionName];
    const gallery = settings.gallery || [];
    const container = $('#cig_gallery_container');
    const emptyMsg = $('#cig_gallery_empty');

    container.empty();

    if (gallery.length === 0) {
        emptyMsg.show();
        return;
    }

    emptyMsg.hide();

    for (let i = 0; i < gallery.length; i++) {
        const item = gallery[i];
        const thumb = $(`
            <div class="cig_gallery_item" data-index="${i}" title="${item.prompt}">
                <img src="data:image/png;base64,${item.imageData}" />
                <div class="cig_gallery_item_overlay">
                    <i class="fa-solid fa-trash cig_gallery_delete" data-index="${i}"></i>
                </div>
            </div>
        `);
        container.append(thumb);
    }
}

async function generateImage() {
    const settings = extension_settings[extensionName];
    const depth = settings.message_depth || 1;
    const recentMessages = getRecentMessages(depth);

    if (recentMessages.length === 0) {
        toastr.warning('No message found to generate image from.', 'Context Image Generation');
        return;
    }

    const generateBtn = $('#cig_generate_btn');
    generateBtn.addClass('generating');
    generateBtn.find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');

    const lastMsg = recentMessages[recentMessages.length - 1];
    const sender = lastMsg.isUser ? `{{user}} (${lastMsg.name})` : `{{char}} (${lastMsg.name})`;

    try {
        const result = await generateImageFromPrompt(lastMsg.text, sender, null);

        if (result) {
            const imageDataUrl = `data:${result.mimeType};base64,${result.imageData}`;
            $('#cig_preview_image').attr('src', imageDataUrl);
            $('#cig_preview_container').show();
            addToGallery(result.imageData, lastMsg.text, null);
        }

    } catch (error) {
        console.error(`[${extensionName}] Generation error:`, error);
        toastr.error(`Failed to generate image: ${error.message}`, 'Context Image Generation');
    } finally {
        generateBtn.removeClass('generating');
        generateBtn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-image');
    }
}

async function cigMessageButton($icon) {
    const context = getContext();

    if ($icon.hasClass('cig_busy')) {
        console.log('[CIG] Already generating...');
        return;
    }

    const messageElement = $icon.closest('.mes');
    const messageId = Number(messageElement.attr('mesid'));
    const message = context.chat[messageId];

    if (!message) {
        console.error('[CIG] Could not find message for generation button');
        return;
    }

    const prompt = message.mes;
    if (!prompt) {
        toastr.warning('No message content to generate from.', 'Context Image Generation');
        return;
    }

    const charName = context.name2 || 'Character';
    const userName = name1 || 'User';
    const sender = message.is_user ? `{{user}} (${userName})` : `{{char}} (${charName})`;

    $icon.addClass('cig_busy');
    $icon.removeClass('fa-wand-magic-sparkles').addClass('fa-spinner fa-spin');

    try {
        const result = await generateImageFromPrompt(prompt, sender, messageId);

        if (result) {
            const fileName = `cig_${Date.now()}`;
            const filePath = await saveBase64AsFile(result.imageData, extensionName, fileName, 'png');
            console.log(`[${extensionName}] Image saved to:`, filePath);

            if (!message.extra || typeof message.extra !== 'object') {
                message.extra = {};
            }

            if (!Array.isArray(message.extra.media)) {
                message.extra.media = [];
            }

            if (!message.extra.media_display) {
                message.extra.media_display = MEDIA_DISPLAY.GALLERY;
            }

            const mediaAttachment = {
                url: filePath,
                type: MEDIA_TYPE.IMAGE,
                title: prompt.substring(0, 100),
                source: MEDIA_SOURCE.GENERATED,
            };

            message.extra.media.push(mediaAttachment);
            message.extra.media_index = message.extra.media.length - 1;
            message.extra.inline_image = true;

            appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
            await saveChatConditional();
            addToGallery(result.imageData, prompt, messageId);
        }

    } catch (error) {
        console.error(`[${extensionName}] Message generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Context Image Generation');
    } finally {
        $icon.removeClass('cig_busy fa-spinner fa-spin').addClass('fa-wand-magic-sparkles');
    }
}

async function autoGenerateForMessage(messageId) {
    const settings = extension_settings[extensionName];
    if (settings.auto_generate === 'off') return;

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || !message.mes || message.is_system) return;

    // Check if we should generate for this message type
    if (settings.auto_generate === 'bot' && message.is_user) return;

    // Wait for the button to be injected, then click it
    setTimeout(() => {
        const messageElement = $(`.mes[mesid="${messageId}"]`);
        const $icon = messageElement.find('.cig_message_gen');
        if ($icon.length > 0 && !$icon.hasClass('cig_busy')) {
            console.log(`[${extensionName}] Auto-generating image for message ${messageId}`);
            cigMessageButton($icon);
        }
    }, 200);
}

async function slashCommandHandler(args, prompt) {
    const trimmedPrompt = String(prompt).trim();

    if (!trimmedPrompt) {
        toastr.warning('Please provide a prompt for image generation.', 'Context Image Generation');
        return '';
    }

    try {
        const result = await generateImageFromPrompt(trimmedPrompt, null, null);

        if (result) {
            const imageDataUrl = `data:${result.mimeType};base64,${result.imageData}`;
            $('#cig_preview_image').attr('src', imageDataUrl);
            $('#cig_preview_container').show();
            addToGallery(result.imageData, trimmedPrompt, null);
            return imageDataUrl;
        }
    } catch (error) {
        console.error(`[${extensionName}] Slash command generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Context Image Generation');
    }

    return '';
}

function injectMessageButton(messageId) {
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (messageElement.length === 0) return;

    const extraButtons = messageElement.find('.extraMesButtons');
    if (extraButtons.length === 0) return;

    if (extraButtons.find('.cig_message_gen').length > 0) return;

    const cigButton = $(`
        <div title="Generate with Gemini 🍌" 
             class="mes_button cig_message_gen fa-solid fa-wand-magic-sparkles" 
             data-i18n="[title]Generate with Gemini 🍌">
        </div>
    `);

    const sdButton = extraButtons.find('.sd_message_gen');
    if (sdButton.length) {
        sdButton.after(cigButton);
    } else {
        extraButtons.prepend(cigButton);
    }
}

function injectAllMessageButtons() {
    $('.mes').each(function () {
        const messageId = $(this).attr('mesid');
        if (messageId !== undefined) {
            injectMessageButton(Number(messageId));
        }
    });
}

async function clearGallery() {
    if (!confirm('Are you sure you want to clear the gallery? This cannot be undone.')) {
        return;
    }

    extension_settings[extensionName].gallery = [];
    saveSettingsDebounced();
    renderGallery();
    toastr.info('Gallery cleared.', 'Context Image Generation');
}

function viewGalleryImage(index) {
    const settings = extension_settings[extensionName];
    const item = settings.gallery[index];
    if (!item) return;

    const imageUrl = `data:image/png;base64,${item.imageData}`;

    const popup = $(`
        <div class="cig_popup_overlay">
            <div class="cig_popup">
                <div class="cig_popup_header">
                    <span>${new Date(item.timestamp).toLocaleString()}</span>
                    <i class="fa-solid fa-xmark cig_popup_close"></i>
                </div>
                <img src="${imageUrl}" />
                <div class="cig_popup_prompt">${item.prompt}</div>
            </div>
        </div>
    `);

    popup.on('click', '.cig_popup_close, .cig_popup_overlay', function (e) {
        if (e.target === this || $(e.target).hasClass('cig_popup_close')) {
            popup.remove();
        }
    });

    $('body').append(popup);
}

function deleteGalleryImage(index) {
    const settings = extension_settings[extensionName];
    settings.gallery.splice(index, 1);
    saveSettingsDebounced();
    renderGallery();
}

jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension...`);

    try {
        const response = await fetch(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
        const settingsHtml = await response.text();
        $('#extensions_settings').append(settingsHtml);
    } catch (error) {
        console.error(`[${extensionName}] Error loading settings template:`, error);
        toastr.error('Failed to load extension settings.', 'Context Image Generation');
        return;
    }

    await loadSettings();

    $('#cig_provider').on('change', function () {
        extension_settings[extensionName].provider = $(this).val();
        updateModelDropdown();
        toggleImageSizeVisibility();
        toggleProviderSpecificSettings();
        saveSettingsDebounced();
    });

    $('#cig_linkapi_key').on('input', function () {
        extension_settings[extensionName].linkapi_key = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_model').on('change', function () {
        extension_settings[extensionName].model = $(this).val();
        toggleImageSizeVisibility();
        saveSettingsDebounced();
    });

    $('#cig_aspect_ratio').on('change', function () {
        extension_settings[extensionName].aspect_ratio = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_image_size').on('change', function () {
        extension_settings[extensionName].image_size = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_thinking_level').on('change', function () {
        extension_settings[extensionName].thinking_level = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_use_google_search').on('change', function () {
        extension_settings[extensionName].use_google_search = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_use_avatars').on('change', function () {
        extension_settings[extensionName].use_avatars = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_include_descriptions').on('change', function () {
        extension_settings[extensionName].include_descriptions = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_use_previous_image').on('change', function () {
        extension_settings[extensionName].use_previous_image = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_auto_generate').on('change', function () {
        extension_settings[extensionName].auto_generate = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_message_depth').on('change', function () {
        let value = parseInt($(this).val(), 10);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 10) value = 10;
        $(this).val(value);
        extension_settings[extensionName].message_depth = value;
        saveSettingsDebounced();
    });

    $('#cig_system_instruction').on('input', function () {
        extension_settings[extensionName].system_instruction = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_generate_btn').on('click', generateImage);
    $('#cig_clear_gallery').on('click', clearGallery);

    $(document).on('click', '.cig_gallery_item img', function () {
        const index = $(this).closest('.cig_gallery_item').data('index');
        viewGalleryImage(index);
    });

    $(document).on('click', '.cig_gallery_delete', function (e) {
        e.stopPropagation();
        const index = $(this).data('index');
        deleteGalleryImage(index);
    });

    $(document).on('click', '.cig_message_gen', function (e) {
        cigMessageButton($(e.currentTarget));
    });

    eventSource.on(event_types.MESSAGE_RENDERED, (messageId) => {
        injectMessageButton(messageId);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        setTimeout(injectAllMessageButtons, 100);
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.CHAT_CREATED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    setTimeout(injectAllMessageButtons, 500);

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'proimagine',
        returns: 'URL of the generated image, or an empty string if generation failed',
        callback: slashCommandHandler,
        aliases: ['proimg', 'geminiimg'],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Prompt for image generation',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Generate an image using Gemini Pro image generation. Example: /proimagine a beautiful sunset over mountains',
    }));

    console.log(`[${extensionName}] Extension loaded successfully!`);
});
