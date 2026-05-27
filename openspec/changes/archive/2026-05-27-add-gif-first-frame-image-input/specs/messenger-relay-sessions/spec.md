## ADDED Requirements

### Requirement: Inbound GIF image prompts use first-frame conversion
The system SHALL accept authorized inbound GIF image attachments for Pi image prompts by converting the GIF's first frame to a supported static image before prompt injection.

#### Scenario: Authorized GIF is accepted for image-capable model
- **WHEN** an authorized paired messenger user sends an inbound `image/gif` attachment and the selected Pi model supports image input
- **THEN** PiRelay validates the attachment size, downloads it only after authorization, converts the first GIF frame to a supported static image MIME type, and injects the prompt with text plus the converted image content block

#### Scenario: GIF caption is preserved as prompt text
- **WHEN** an authorized paired messenger user sends an inbound GIF with caption text and the GIF converts successfully
- **THEN** PiRelay uses the caption as the prompt text and attaches the converted first-frame image

#### Scenario: Image-only GIF uses image inspection fallback
- **WHEN** an authorized paired messenger user sends an inbound GIF without caption text and the GIF converts successfully
- **THEN** PiRelay uses the same safe image-inspection fallback prompt used for other image-only messages and attaches the converted first-frame image

#### Scenario: Current model lacks image support for GIF
- **WHEN** an authorized paired messenger user sends an inbound GIF but the selected Pi model does not support image input
- **THEN** PiRelay rejects the image-bearing prompt without injecting the caption as a partial text-only prompt

#### Scenario: GIF conversion fails safely
- **WHEN** an authorized paired messenger user sends a corrupt, unsupported, oversized, or conversion-failing GIF
- **THEN** PiRelay returns a safe actionable error through the originating messenger and does not inject any prompt or persist the GIF bytes in relay state

#### Scenario: Mixed direct and convertible images are accepted together
- **WHEN** an authorized paired messenger user sends a supported direct image and a valid GIF attachment in the same message and the selected Pi model supports image input
- **THEN** PiRelay preserves the direct image content and includes the converted GIF first-frame image in the same prompt delivery subject to existing message and size limits
