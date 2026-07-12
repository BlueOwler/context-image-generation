# Context Image Generation 🍌

A SillyTavern extension that adds Gemini-powered image generation with character context and avatar references.

> **Fork notice** — This is a fork of [elouannd/context-image-generation](https://github.com/elouannd/context-image-generation) by **Elouann**. It was forked to add **LinkAPI provider support** (routing image generation through LinkAPI's Gemini-compatible endpoint) without changing your active SillyTavern Chat Completion profile. All credit for the original extension goes to Elouann; the original is released into the public domain under The Unlicense.

## What's New in this Fork (v1.4.0)

- **LinkAPI Provider** - Added LinkAPI as a provider option. Enter a LinkAPI key (used only for image generation) and requests are routed through `https://api.linkapi.ai` without touching your active Chat Completion proxy settings.

## What's New in v1.3.3

- **Auto Generate** - Automatically generate images when messages are received (Off, Bot messages, or All messages)

## What's New in v1.3.2

- **Thinking Level** - Control how much the model "thinks" before generating (Auto, Minimal, Low, Medium, High) — Flash 2 only
- **Google Search** - Let the model search the web for reference images and information before generating — Flash 2 only (may not work on OpenRouter)
- **Updated System Prompt** - Default prompt now mentions internet search capabilities

## What's New in v1.3.1

- **Expanded Image Sizes** - Added support for 512px to 4K resolutions for Nano Banana 2 (Flash)

## What's New in v1.3.0

- **Nano Banana 2 (Flash)** - Added `gemini-3.1-flash-image-preview` as a new model option

## What's New in v1.2

- **Provider Selection** - Choose between Google AI Studio or OpenRouter
- **4K Image Support** - Generate 4K images with Gemini 3 Pro
- **Dynamic Model List** - Models update automatically based on selected provider

## What's New in v1.1

- **Message Depth** - Include 1-10 previous messages as story context for better scene understanding
- **Previous Image Reference** - Use last generated image as style reference for consistency
- **File-Based Storage** - Images saved to files instead of base64 in chat logs

## Features

- **Message Generation Button** - Wand icon in the dropdown menu on each message to generate an image from that message's content
- **Character Context** - Automatically includes character and user descriptions in prompts
- **Avatar References** - Uses character and user avatars as visual references for consistent art
- **Slash Command** - `/proimagine <prompt>` for quick generation

## Requirements

> ⚠️ **Important:** A Paid Tier of AiStudio or OpenRouter credits is needed to generate pictures. Free version will not work.

- SillyTavern (latest staging branch)
- Google AI Studio API key OR OpenRouter API key configured in SillyTavern, OR a LinkAPI key entered in this extension's settings
- A Gemini model with image generation capability:
  - `Nano Banana 🍌` (Flash) - Faster, cheaper (~$0.04/image)
  - `Nano Banana 2 🍌` (Flash) - Gemini 3.1 Flash
  - `Nano Banana Pro 🍌` (Pro) - Higher quality, 4K support (~$0.14/image)

## Installation

1. Navigate to your SillyTavern in the Extensions.
2. Click on Install Extension Button and paste this repo link
3. Configure your API key in Chat Completion settings
4. Profit!
   
## Usage

### Message Button
1. Open a chat with a character
2. Click the "..." menu on any message
3. Click the wand icon (✨) to generate an image from that message

### Settings Panel
- Select your provider (Google AI Studio or OpenRouter)
- Choose model, aspect ratio, and image size
- Toggle avatar references and character descriptions
- Customize the system instruction
- View and manage gallery

### Slash Command
```
/proimagine a beautiful sunset over mountains
```
Aliases: `/proimg`, `/geminiimg`

## Configuration

| Setting | Description |
|---------|-------------|
| Provider | Google AI Studio, LinkAPI, or OpenRouter |
| LinkAPI Key | Required when Provider is LinkAPI; used only for image generation |
| Model | Flash (~$0.04), Flash 2 (Gemini 3.1), or Pro (~$0.14) |
| Aspect Ratio | 1:1, 3:4, 4:3, 9:16, or 16:9 |
| Image Size | Pro: Default, 1K, 2K, 4K <br> Flash 2: Default, 512px, 1K, 2K, 4K |
| Thinking Level | Flash 2 only: Auto, Minimal, Low, Medium, High |
| Google Search | Flash 2 only: Enable web search for references |
| Auto Generate | Off, Bot messages, or All messages |
| Message Depth | Number of messages to include as context (1-10) |
| Use Avatar References | Include character/user avatars as visual references |
| Include Descriptions | Add character descriptions to the prompt |
| Use Previous Image | Use last generated image as style reference |
| System Instruction | Customize instructions for the image model |

## Troubleshooting
- Swiping a picture will result in an error.


## To-Do
[ ] Add Support for other Image generation services like Z-ai and Flux

## License

This project is released into the public domain under [The Unlicense](LICENSE). You are free to use, modify, and distribute this code for any purpose, with or without attribution.

## Credits

- Original extension by **Elouann** — [elouannd/context-image-generation](https://github.com/elouannd/context-image-generation).
- LinkAPI provider support added in this fork by **BlueOwler**.
- Created for use with [SillyTavern](https://github.com/SillyTavern/SillyTavern).
