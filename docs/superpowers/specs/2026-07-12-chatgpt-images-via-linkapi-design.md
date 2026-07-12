# Design: ChatGPT (gpt-image) support via LinkAPI

**Date:** 2026-07-12
**Branch:** `feature/chatgpt-images`
**Status:** Approved design — ready for implementation planning

## Goal

Let this extension generate images with OpenAI "ChatGPT" image models
(`gpt-image-2-c`, and any `gpt-image*` / `dall-e*` siblings) served through the
user's existing **LinkAPI** account — alongside the current Gemini / Nano Banana
models. **No changes to SillyTavern core.**

## Constraints & non-goals

- **No SillyTavern core changes.** The feature lives entirely in the extension.
- **Text prompt only for ChatGPT models.** LinkAPI's `/v1/images/generations`
  accepts only a text `prompt` — no image-input parameter. Avatar/character
  *image* references and "use previous image" therefore do **not** apply to
  ChatGPT models. (They keep working for Gemini/nano, which are unchanged.)
  Character/user *text descriptions* still flow into the prompt.
- Not building `/v1/images/edits` / reference-image support. The docs for that
  endpoint proved to be auto-templated and unreliable, and the user confirmed
  text-only is acceptable.
- The existing Gemini path (via ST's `/api/backends/chat-completions/generate`)
  is untouched.

## Key facts established during design (empirically verified)

- **Endpoint:** `POST https://linkapi.ai/v1/images/generations` (apex host, not
  `api.linkapi.ai`). Auth: `Authorization: Bearer <linkapi_key>`.
- **Request params (from LinkAPI docs):** `prompt` (required string), `size`
  (default `1024x1024`), `quality`, `style`, `n` (1–10, default 1),
  `response_format` (default `url`). No image-input parameter.
- **CORS verified:** a browser `fetch()` from ST's page origin
  (`http://localhost:8000`) to `/v1/images/generations` returned an HTTP 401
  (invalid dummy key) with a JSON body — i.e. the preflight passed and CORS is
  allowed. Same verified for `GET /v1/models`.
- **Gateway:** error body shape `{"error":{"code":"","message":"...","type":"new_api_error"}}`.
  LinkAPI runs the **New-API** OpenAI-compatible gateway, which sets permissive
  CORS by default.
- ST's built-in `/api/openai/generate-image` proxy hardcodes `api.openai.com`
  and uses ST's stored OpenAI key (`src/endpoints/openai.js:643`) — cannot be
  pointed at LinkAPI without core changes. Hence direct browser fetch.

## Architecture

Branch by **model id**, not by adding a new provider. LinkAPI already exists as
a provider with the user's key (`linkapi_key`); ChatGPT models reuse the same
provider and key and differ only in transport.

```
generateImageFromPrompt(prompt, sender, messageId)
  ├─ provider === 'linkapi' && isOpenAiImageModel(model)
  │     → generateViaLinkApiImages(...)   [NEW: direct fetch to LinkAPI]
  └─ else
        → existing ST chat-completions path (Gemini/nano)   [UNCHANGED]
```

- `isOpenAiImageModel(model)` = `/^(gpt-image|dall-e)/i.test(model)`.
- Both branches **return the same shape**: `{ imageData: <base64>, mimeType }`,
  so all downstream code (preview, gallery, file save, error toast) is unchanged.
  This is the adapter boundary.

## Components

### 1. `generateViaLinkApiImages(prompt, sender, messageId)` — new function

Responsibilities:

1. **Build the prompt text.** Reuse `buildMessages(prompt, sender, messageId)`
   and keep only the `type === 'text'` parts, joined with `\n\n`. Drop
   `image_url` parts. This preserves system instruction + character/user
   descriptions + story context with zero duplicated logic.
2. **Map aspect ratio → size** (see mapping below).
3. **POST** to `https://linkapi.ai/v1/images/generations` with headers
   `{ 'Content-Type': 'application/json', Authorization: 'Bearer ' + linkapi_key }`
   and body:
   ```json
   { "model": "<id>", "prompt": "<text>", "n": 1,
     "size": "<mapped>", "response_format": "b64_json" }
   ```
4. **Parse response** (see below) → return `{ imageData, mimeType: 'image/png' }`.
5. **Errors** → throw `Error(message)` parsed from `{error:{message}}`; the
   existing caller shows it via `toastr.error`.

### 2. Aspect-ratio → size mapping

| Aspect ratio (existing UI) | gpt-image `size` |
|----------------------------|------------------|
| `1:1`                      | `1024x1024`      |
| `3:4`, `9:16`              | `1024x1536`      |
| `4:3`, `16:9`              | `1536x1024`      |
| (unset / other)            | `1024x1024`      |

### 3. Response parsing

Standard OpenAI-images / New-API shape:
```json
{ "created": ..., "data": [ { "b64_json": "..." } ] }
```
- Prefer `data[0].b64_json` → `imageData`.
- Fallback: if only `data[0].url` is present, `fetch` it and convert to base64
  (handles the case where the gateway ignores `response_format`).
- If neither present → throw "No image was returned by the API".

### 4. Model list (hybrid: curated default + optional fetch)

- **Curated default** in `PROVIDER_MODELS.linkapi`: add a `gpt-image-2-c` entry
  with a friendly label (e.g. `ChatGPT Image (gpt-image-2-c)`). Guarantees it
  works out of the box.
- **Optional dynamic fetch:** a 🔄 "Fetch models" button next to the LinkAPI key.
  On click (key present): `GET https://linkapi.ai/v1/models`, filter
  `data[].id` matching `^(gpt-image|dall-e)`, and merge results into the LinkAPI
  model dropdown. On failure/empty, keep the curated default and toast a notice.
  Rationale: `/v1/models` has no capability flag, and only OpenAI-family image
  models are schema-compatible with `/v1/images/generations`.

### 5. UI (`settings.html` + `index.js`)

- Add the curated ChatGPT model to the LinkAPI model list (populated by the
  existing `updateModelDropdown()` from `PROVIDER_MODELS`).
- Add the 🔄 fetch-models button inside the existing `#cig_linkapi_container`.
- When an `isOpenAiImageModel` model is selected, show a small inline note:
  *"ChatGPT models: text prompt only — reference images are not supported."*
  Reuse the existing `toggleImageSizeVisibility()` pattern to hide
  Gemini-only controls that don't apply (thinking level, Google search). Avatar
  and previous-image toggles may remain visible but are simply not sent on this
  path (no-op); optionally grey them out (polish, not required).

## Data flow

```
User clicks generate (message button / slash command / auto)
  → generateImage()/cigMessageButton() → generateImageFromPrompt()
    → [linkapi + gpt-image] generateViaLinkApiImages()
        → buildMessages() → flatten text
        → fetch LinkAPI /v1/images/generations (Bearer linkapi_key)
        → parse data[0].b64_json
      returns { imageData, mimeType }
  → preview + addToGallery() + existing file-save path  (unchanged)
```

## Error handling

- Non-OK HTTP: parse body as JSON, surface `error.message` (e.g. "Invalid
  token"); fall back to `HTTP <status>` if unparseable.
- Network/CORS failure (should not occur — verified): the thrown TypeError
  propagates to the existing `catch` → `toastr.error`.
- Empty/missing image in a 200 response: throw a clear message.

## Security / secrets

- The LinkAPI key is already stored in `extension_settings` (browser-side) and
  is sent directly to `linkapi.ai` over HTTPS — no worse than the existing nano
  path, which also originates the key in the browser. The key is never committed
  (default empty string; `type="password"` field).
- No secrets are added to the repo. Requests go only to the user-configured
  LinkAPI host.

## Testing / verification

No automated test harness exists (browser extension). Verification is manual in
a running SillyTavern:

1. Enter a LinkAPI key, select the ChatGPT model.
2. Generate from a message → image appears in preview and gallery.
3. (If implemented) click 🔄 → dropdown populates with `gpt-image*`/`dall-e*`.
4. Bad key → `toastr.error` shows "Invalid token".
5. Regression: switch back to a Gemini/nano model → unchanged behaviour.

The CORS gate is already proven for both `/v1/images/generations` and
`/v1/models`.

## Out of scope (future)

- Reference-image support via `/v1/images/edits` (needs an empirical test that
  the endpoint accepts an input image; docs are unreliable).
- A dedicated size dropdown with exact gpt-image sizes.
- Non-OpenAI image families (flux, sdxl) that use different request schemas.
