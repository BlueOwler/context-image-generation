# ChatGPT (gpt-image) via LinkAPI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI "ChatGPT" image models (`gpt-image-2-c`, plus optional
fetched `gpt-image*`/`dall-e*` siblings) as an image source, served through the
user's existing LinkAPI account, with no SillyTavern core changes.

**Architecture:** Branch by model id inside `generateImageFromPrompt`. When the
provider is `linkapi` and the model is a gpt-image model, the extension flattens
the text it already assembles and does a direct browser `fetch()` to LinkAPI's
`/v1/images/generations` (CORS verified). Both branches return the same
`{ imageData, mimeType }` shape, so preview/gallery/file-save are unchanged. The
existing Gemini path is untouched.

**Tech Stack:** Vanilla ES-module JS + jQuery (SillyTavern third-party
extension). No build step, no test framework. Verification is done in the
running SillyTavern app and its DevTools console.

## Global Constraints

- No changes to any file outside this extension folder
  (`.../extensions/context-image-generation/`). SillyTavern core is off-limits.
- All work stays on branch `feature/chatgpt-images`.
- ChatGPT/gpt-image models are **text-prompt only** — never send image parts to
  `/v1/images/generations`.
- LinkAPI host: `https://linkapi.ai`. Endpoint: `POST /v1/images/generations`.
  Auth header: `Authorization: Bearer <linkapi_key>`.
- The LinkAPI key comes only from `extension_settings[extensionName].linkapi_key`
  and is never written to the repo.
- Model trigger regex (used identically everywhere): `/^(gpt-image|dall-e)/i`.
- Aspect-ratio → size map: `1:1`→`1024x1024`; `3:4`,`9:16`→`1024x1536`;
  `4:3`,`16:9`→`1536x1024`; anything else→`1024x1024`.
- Request body: `{ model, prompt, n: 1, size, response_format: 'b64_json' }`.
- The full spec is at
  `docs/superpowers/specs/2026-07-12-chatgpt-images-via-linkapi-design.md`.

## Verification model (read before starting)

There is no automated test runner in this repo. Each task's "test" steps are run
in the **browser DevTools console** on the running SillyTavern page
(`http://localhost:8000`, press F12 → Console). To make internal functions
reachable from the console, Task 1 adds a `window.cigDebug` hook. After editing
`index.js`, you must **hard-reload** SillyTavern (Ctrl+Shift+R) for changes to
load, because the extension is a static ES module.

## File Structure

- **Modify:** `index.js` — add pure helpers + `requestLinkApiImage`, the
  `window.cigDebug` hook, the model entry, the `updateModelDropdown` refactor,
  the branch in `generateImageFromPrompt`, the ChatGPT note toggle, and (Task 5)
  the fetch-models function + handler.
- **Modify:** `settings.html` — ChatGPT note element; fetch-models button.
- **Modify:** `manifest.json`, `README.md` — version bump + changelog (Task 6).

No new source files: the extension keeps everything in `index.js`, and a
separate browser-ESM module would introduce MIME/module friction for no benefit.

---

### Task 1: Pure helpers + debug hook

**Files:**
- Modify: `index.js` (add functions after `PROVIDER_MODELS`/`defaultSettings`
  block, around line 68, before `updateModelDropdown`)

**Interfaces:**
- Produces:
  - `isOpenAiImageModel(model: string): boolean`
  - `mapAspectRatioToSize(aspectRatio: string): string`
  - `extractPromptText(messages: Array<{role,content}>): string`
  - `parseImagesResponse(json: any): { b64: string|null, url: string|null }`
  - `arrayBufferToBase64(buf: ArrayBuffer): string`
  - `window.cigDebug` exposing all of the above (dev aid; harmless in prod)

- [ ] **Step 1: Add the helpers**

Insert into `index.js` immediately after `const MAX_GALLERY_SIZE = 50;`
(currently line 68) and before `function updateModelDropdown()`:

```javascript
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

// Dev aid: reach the pure helpers from the DevTools console for verification.
window.cigDebug = Object.assign(window.cigDebug || {}, {
    isOpenAiImageModel,
    mapAspectRatioToSize,
    extractPromptText,
    parseImagesResponse,
});
```

- [ ] **Step 2: Verify it fails first (before adding code)**

In ST DevTools console (on the current, unmodified build):

Run: `window.cigDebug && window.cigDebug.mapAspectRatioToSize`
Expected: `undefined` (helpers/hook don't exist yet).

- [ ] **Step 3: Load the change**

Save `index.js`, then hard-reload SillyTavern (Ctrl+Shift+R).

- [ ] **Step 4: Verify the helpers pass**

In ST DevTools console, run each and confirm the expected output:

```javascript
cigDebug.isOpenAiImageModel('gpt-image-2-c')            // true
cigDebug.isOpenAiImageModel('gemini-2.5-flash-image')   // false
cigDebug.mapAspectRatioToSize('16:9')                   // "1536x1024"
cigDebug.mapAspectRatioToSize('9:16')                   // "1024x1536"
cigDebug.mapAspectRatioToSize('1:1')                    // "1024x1024"
cigDebug.mapAspectRatioToSize('weird')                  // "1024x1024"
cigDebug.extractPromptText([{role:'user',content:[{type:'text',text:'a'},{type:'image_url',image_url:{}},{type:'text',text:'b'}]}])   // "a\n\nb"
cigDebug.parseImagesResponse({data:[{b64_json:'XYZ'}]}) // {b64:"XYZ", url:null}
cigDebug.parseImagesResponse({data:[{url:'http://x'}]}) // {b64:null, url:"http://x"}
cigDebug.parseImagesResponse({})                        // {b64:null, url:null}
```

Expected: every line returns the value in the comment.

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: add LinkAPI gpt-image pure helpers + debug hook"
```

---

### Task 2: `requestLinkApiImage` fetch wrapper

**Files:**
- Modify: `index.js` (add after `arrayBufferToBase64`, before the
  `window.cigDebug` assignment — then extend the hook to include it)

**Interfaces:**
- Consumes: `parseImagesResponse`, `arrayBufferToBase64` (Task 1)
- Produces:
  `async requestLinkApiImage({ apiKey, model, prompt, size, host? }): Promise<{ imageData: string, mimeType: string }>`
  — throws `Error(message)` on non-OK responses (message parsed from
  `{error:{message}}`) and when no image is present.

- [ ] **Step 1: Add the function**

Insert into `index.js` after `arrayBufferToBase64` and BEFORE the
`window.cigDebug = ...` assignment:

```javascript
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
```

Then extend the debug hook (replace the existing `window.cigDebug = ...` block
from Task 1 with this, adding `requestLinkApiImage`):

```javascript
window.cigDebug = Object.assign(window.cigDebug || {}, {
    isOpenAiImageModel,
    mapAspectRatioToSize,
    extractPromptText,
    parseImagesResponse,
    requestLinkApiImage,
});
```

- [ ] **Step 2: Verify the error path fails cleanly (invalid key)**

Save, hard-reload ST. In DevTools console:

```javascript
await cigDebug.requestLinkApiImage({ apiKey: 'bad', model: 'gpt-image-2-c', prompt: 'test', size: '1024x1024' }).catch(e => e.message)
```

Expected: a string containing `Invalid token` (the 401 body's message), NOT a
generic `API Error: 401`. This proves the fetch, the non-OK branch, and the
error-message parsing all work against the real endpoint.

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add requestLinkApiImage LinkAPI images fetch wrapper"
```

---

### Task 3: Wire the branch, add the model, fix the dropdown

**Files:**
- Modify: `index.js` — `PROVIDER_MODELS.linkapi` (line 39-43);
  module-level `fetchedLinkApiModels` declaration (near line 68);
  `updateModelDropdown` (lines 70-99); `generateImageFromPrompt` (after the
  existing `isLinkApi` declaration, currently line 358, before `requestBody`).

**Interfaces:**
- Consumes: `isOpenAiImageModel`, `extractPromptText`, `mapAspectRatioToSize`
  (Task 1), `requestLinkApiImage` (Task 2), existing `buildMessages`.
- Produces: `fetchedLinkApiModels` (module-level `let`, runtime-only, consumed by
  Task 5); `generateImageFromPrompt` now returns via LinkAPI for gpt-image models.

- [ ] **Step 1: Add the curated gpt-image model**

In `index.js`, change the `linkapi` block of `PROVIDER_MODELS` (lines 39-43) to
add a `gptimage` entry:

```javascript
    linkapi: {
        flash: { id: 'gemini-2.5-flash-image', name: 'Nano Banana 🍌 (LinkAPI)' },
        flash2: { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2 🍌 (LinkAPI)' },
        pro: { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro 🍌 (LinkAPI)' },
        gptimage: { id: 'gpt-image-2-c', name: 'ChatGPT Image 🖼️ (gpt-image-2-c)' },
    },
```

- [ ] **Step 2: Add the runtime models list**

In `index.js`, immediately after `const MAX_GALLERY_SIZE = 50;` (line 68), add:

```javascript
// Runtime-only list of image models fetched from LinkAPI /v1/models (not persisted).
let fetchedLinkApiModels = [];
```

- [ ] **Step 3: Refactor `updateModelDropdown` to render all models and keep exact selection**

Replace the entire body of `updateModelDropdown` (lines 70-99) with:

```javascript
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
```

- [ ] **Step 4: Add the LinkAPI branch in `generateImageFromPrompt`**

In `index.js`, find these existing lines inside `generateImageFromPrompt`
(currently 356-358):

```javascript
    const isFlash2 = /gemini-3\.1/.test(settings.model);
    const selectedProvider = settings.provider || 'makersuite';
    const isLinkApi = selectedProvider === 'linkapi';
```

Immediately AFTER that `isLinkApi` line and BEFORE `const requestBody = {`,
insert:

```javascript
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
```

(`messages` is already declared just above at the top of the function — reuse
it; do NOT redeclare. The Gemini `requestBody` code below is unchanged.)

- [ ] **Step 5: Verify end-to-end in SillyTavern**

Save `index.js`, hard-reload ST. Then:
1. Open the extension settings → set Provider = **LinkAPI**, paste your real
   LinkAPI key, select model **ChatGPT Image 🖼️ (gpt-image-2-c)**.
2. Open a chat, click a message's wand icon (or run `/proimagine a red apple`).
3. Expected: an image is generated and appears in the preview + gallery.
4. Reload ST and re-open settings. Expected: the model dropdown **still shows
   `ChatGPT Image ...` selected** (not silently reset to Nano Banana) — this
   confirms Step 3's exact-selection fix.
5. Switch Provider to Google AI Studio and back — no errors; Gemini models
   still list and generate.

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat: route gpt-image models through LinkAPI images endpoint"
```

---

### Task 4: ChatGPT-only UI note

**Files:**
- Modify: `settings.html` (model selection area)
- Modify: `index.js` — `toggleImageSizeVisibility` (lines 135-146)

**Interfaces:**
- Consumes: `isOpenAiImageModel` (Task 1)

- [ ] **Step 1: Add the note element**

In `settings.html`, find the Model Selection block (the `<div>` containing
`<select id="cig_model" ...>`). Immediately after that select's closing `</div>`
for the field, add:

```html
<small id="cig_chatgpt_note" style="display: none; opacity: 0.8;">
    ChatGPT models: text prompt only — avatar/reference images are not supported.
</small>
```

- [ ] **Step 2: Toggle the note by model type**

In `index.js`, in `toggleImageSizeVisibility` (lines 135-146), add a line at the
end of the function body (after the existing `if (isSizeSupported) { ... }`):

```javascript
    $('#cig_chatgpt_note').toggle(isOpenAiImageModel(model));
```

- [ ] **Step 3: Verify in SillyTavern**

Save both files, hard-reload ST. In extension settings:
- Select the ChatGPT model → the note appears; the Flash-2 options
  (thinking level / Google search) and the image-size dropdown are hidden.
- Select a Nano Banana model → the note disappears.

- [ ] **Step 4: Commit**

```bash
git add index.js settings.html
git commit -m "feat: show text-only note for ChatGPT image models"
```

---

### Task 5: Optional — fetch model list from LinkAPI

**Files:**
- Modify: `settings.html` (LinkAPI container `#cig_linkapi_container`)
- Modify: `index.js` — new `fetchLinkApiModels`; click handler in the
  `jQuery(async () => { ... })` block (near line 742, after the
  `#cig_linkapi_key` input handler)

**Interfaces:**
- Consumes: `fetchedLinkApiModels`, `updateModelDropdown` (Task 3)
- Produces: `async fetchLinkApiModels(): Promise<void>`

- [ ] **Step 1: Add the button**

In `settings.html`, inside `#cig_linkapi_container`, after the LinkAPI key
`<input>` and its `<small>` help line, add:

```html
<div class="flex-container" style="margin-top: 5px;">
    <input id="cig_fetch_linkapi_models" class="menu_button" type="button" value="🔄 Fetch models" />
</div>
```

- [ ] **Step 2: Add the fetch function**

In `index.js`, add near the other LinkAPI helpers (e.g. after
`requestLinkApiImage`):

```javascript
async function fetchLinkApiModels() {
    const settings = extension_settings[extensionName];
    const key = settings.linkapi_key;
    if (!key) {
        toastr.warning('Enter a LinkAPI key first.', 'Context Image Generation');
        return;
    }
    try {
        const resp = await fetch('https://linkapi.ai/v1/models', {
            headers: { 'Authorization': `Bearer ${key}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const ids = (json.data || [])
            .map(m => m.id)
            .filter(id => /^(gpt-image|dall-e)/i.test(id));
        fetchedLinkApiModels = ids.map(id => ({ id, name: id }));
        updateModelDropdown();
        toastr.success(`Loaded ${ids.length} image model(s).`, 'Context Image Generation');
    } catch (e) {
        console.error(`[${extensionName}] Fetch models failed:`, e);
        toastr.error(`Failed to fetch models: ${e.message}`, 'Context Image Generation');
    }
}
```

- [ ] **Step 3: Wire the click handler**

In `index.js`, inside `jQuery(async () => { ... })`, right after the
`$('#cig_linkapi_key').on('input', ...)` handler (line 739-742), add:

```javascript
    $('#cig_fetch_linkapi_models').on('click', fetchLinkApiModels);
```

- [ ] **Step 4: Verify in SillyTavern**

Save both files, hard-reload ST. With Provider = LinkAPI and a valid key:
- Click **🔄 Fetch models**. Expected: a success toast, and the model dropdown
  now lists any `gpt-image*`/`dall-e*` ids returned by your account (in addition
  to the curated `gpt-image-2-c`).
- Clear the key and click again. Expected: a warning toast, no crash.

- [ ] **Step 5: Commit**

```bash
git add index.js settings.html
git commit -m "feat: fetch gpt-image/dall-e model list from LinkAPI"
```

---

### Task 6: Version bump + changelog

**Files:**
- Modify: `manifest.json` (`version`)
- Modify: `README.md` (fork "What's New" section)

- [ ] **Step 1: Bump the version**

In `manifest.json`, change `"version": "1.4.0",` to `"version": "1.5.0",`.

- [ ] **Step 2: Add a changelog note**

In `README.md`, under the `## What's New in this Fork (v1.4.0)` section, add a
new section above it:

```markdown
## What's New in this Fork (v1.5.0)

- **ChatGPT image models** - Generate images with OpenAI `gpt-image` models
  (e.g. `gpt-image-2-c`) through your LinkAPI account. Text-prompt only
  (character/user descriptions are included; avatar image references are not
  supported for these models). Optional "Fetch models" button lists the
  `gpt-image*`/`dall-e*` models available on your key.
```

- [ ] **Step 3: Verify**

Open the extension settings in ST; confirm no errors on load. `git diff` shows
only version + README changes.

- [ ] **Step 4: Commit**

```bash
git add manifest.json README.md
git commit -m "docs: bump to v1.5.0 for ChatGPT image support"
```

---

## Self-Review

**Spec coverage:**
- Direct fetch to `/v1/images/generations` → Task 2 + Task 3 branch. ✅
- Branch by model id (`isOpenAiImageModel`) → Task 1 + Task 3. ✅
- Text-only prompt from `buildMessages` text parts → `extractPromptText` (Task 1)
  used in Task 3. ✅
- Aspect-ratio → size map → `mapAspectRatioToSize` (Task 1). ✅
- Response parse `b64_json` + url fallback, return `{imageData,mimeType}` →
  `parseImagesResponse` + `requestLinkApiImage` (Tasks 1-2). ✅
- Error handling `{error:{message}}` → `requestLinkApiImage` (Task 2). ✅
- Curated model + hybrid fetch → Task 3 (curated) + Task 5 (fetch). ✅
- UI note + hide Gemini-only controls → Task 4 (note; hiding already handled by
  existing `toggleImageSizeVisibility` because gpt-image is neither pro nor
  flash2). ✅
- No ST core changes → all tasks touch only extension files. ✅
- Version/README → Task 6. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every verify
step gives an exact console command or UI action with expected result.

**Type consistency:** `requestLinkApiImage` returns `{imageData, mimeType}` —
matches the existing Gemini return in `generateImageFromPrompt` and the
`generateImage()`/`cigMessageButton()` consumers. `fetchedLinkApiModels` is a
`[{id,name}]` array in Task 3's declaration, Task 3's dropdown render, and Task
5's population. `isOpenAiImageModel`/`extractPromptText`/`mapAspectRatioToSize`/
`parseImagesResponse` signatures are used identically across Tasks 1, 3, 4, 5.
