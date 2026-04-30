## ADDED Requirements

### Requirement: Remote image prompt delivery
The system SHALL route authorized Telegram photo messages and supported image documents into the bound Pi session as image-capable user prompts while preserving the same authorization, paused-state, offline-state, and busy-delivery rules used for text prompts.

#### Scenario: Authorized Telegram photo becomes Pi image prompt
- **WHEN** an authorized Telegram user sends a photo message with a caption while the bound Pi session is online, unpaused, idle, and using an image-capable model
- **THEN** the system downloads an accepted photo size after authorization and injects a user prompt containing the caption text and an image content block for the photo

#### Scenario: Authorized image document becomes Pi image prompt
- **WHEN** an authorized Telegram user sends a document whose MIME type is an accepted image type while the bound Pi session is online, unpaused, idle, and using an image-capable model
- **THEN** the system downloads the document after authorization and injects a user prompt containing the caption or a safe image-inspection fallback text plus an image content block for the document

#### Scenario: Image-only prompt uses fallback text
- **WHEN** an authorized Telegram user sends a supported image without text or caption while delivery to Pi is otherwise allowed
- **THEN** the system injects the image with a default text prompt that asks Pi to inspect the attached image

#### Scenario: Busy session receives image prompt
- **WHEN** an authorized Telegram user sends a supported image while the Pi session is processing
- **THEN** the system queues the image-bearing prompt using the configured busy delivery mode unless an explicit `/steer` or `/followup` caption selects a delivery mode

#### Scenario: Current model does not support images
- **WHEN** an authorized Telegram user sends a supported image but the bound Pi session's current model does not accept image input
- **THEN** the system rejects the image-bearing prompt, does not inject a partial text-only prompt, and explains how to switch to an image-capable model or resend text only

#### Scenario: Unauthorized image is not downloaded
- **WHEN** an unbound or unauthorized Telegram user sends a photo or document to the bot
- **THEN** the system rejects the update using the existing authorization behavior and MUST NOT download the referenced Telegram file

### Requirement: Telegram image transport validation
The system SHALL enforce safe Telegram image transport constraints before injecting inbound images into Pi or sending outbound images to Telegram.

#### Scenario: Unsupported document type is sent
- **WHEN** an authorized Telegram user sends a non-image document or an image document with an unsupported MIME type
- **THEN** the system does not inject the attachment into Pi and replies with the accepted image formats

#### Scenario: Inbound image exceeds size limit
- **WHEN** an authorized Telegram user sends a photo or image document whose metadata or downloaded byte size exceeds the configured inbound image limit
- **THEN** the system does not inject the image into Pi and replies with a size-limit explanation

#### Scenario: Telegram file download fails
- **WHEN** a supported authorized image cannot be fetched from Telegram after the update is accepted
- **THEN** the system does not inject an incomplete image prompt and replies with a retry-safe error message

#### Scenario: Multiple image candidates are present
- **WHEN** Telegram provides multiple sizes for a photo
- **THEN** the system selects the best supported size within configured limits rather than sending duplicate photo sizes to Pi

### Requirement: Latest turn image retrieval
The system SHALL let the authorized Telegram user explicitly retrieve supported image outputs from the latest completed Pi turn without automatically sending local user images or arbitrary workspace files.

#### Scenario: Latest turn has image outputs
- **WHEN** the latest completed Pi turn produced one or more supported image content blocks from tool results
- **THEN** the Telegram completion notification indicates that images are available and exposes an explicit retrieval action such as `/images` or an inline button

#### Scenario: User requests latest images
- **WHEN** the authorized Telegram user invokes the latest-image retrieval action for the current assistant turn
- **THEN** the system sends the bounded latest-turn images to Telegram as documents with safe filenames and MIME types

#### Scenario: Latest turn references a generated image file
- **WHEN** the latest completed Pi turn references a local workspace image file with an accepted image extension and the authorized Telegram user invokes the latest-image retrieval action
- **THEN** the system validates that the file is a regular accepted image within the workspace and sends it to Telegram as a document with a safe filename

#### Scenario: User explicitly sends a workspace image path
- **WHEN** the authorized Telegram user invokes an explicit image-send command with a relative workspace path to an accepted image file
- **THEN** the system validates workspace containment, MIME type, and outbound size before sending the file as a Telegram document

#### Scenario: Referenced image path is unsafe or invalid
- **WHEN** latest-image retrieval or an explicit image-send command targets an absolute path, a path with traversal, a symlink outside the workspace, a missing file, a non-image, or an oversized image
- **THEN** the system does not send the file and replies with an actionable validation failure message

#### Scenario: No latest images are available
- **WHEN** the authorized Telegram user invokes the latest-image retrieval action before any retrievable latest-turn images exist
- **THEN** the system replies that no images are available, explains that only captured image outputs or safe latest-turn workspace image files can be sent, and does not send empty documents

#### Scenario: Outbound image exceeds size limit
- **WHEN** a latest-turn image exceeds the configured outbound Telegram image limit
- **THEN** the system skips that image, reports that it was too large to send, and continues sending any remaining images that fit the limits

#### Scenario: Local user image is not echoed by default
- **WHEN** the local Pi user or a remote Telegram user supplied an input image during the latest turn
- **THEN** the system does not include that input image in latest-image retrieval unless it was separately emitted as a tool-result image output

#### Scenario: Arbitrary workspace images are not discoverable
- **WHEN** the authorized Telegram user invokes latest-image retrieval
- **THEN** the system does not browse arbitrary workspace images and only considers captured image outputs or safe image file references associated with the latest turn

#### Scenario: Stale image retrieval action is used
- **WHEN** the authorized Telegram user invokes an inline image retrieval action for an assistant turn that is no longer current
- **THEN** the system rejects the stale action and does not send images from an older turn

### Requirement: Image bridge broker parity
The system SHALL provide equivalent image prompt delivery and latest-image retrieval behavior in both in-process and broker runtimes.

#### Scenario: Broker runtime delivers image prompt
- **WHEN** the singleton broker owns Telegram polling and an authorized Telegram image prompt is accepted
- **THEN** the broker delivers the same text and image content blocks to the session-owning Pi client that the in-process runtime would inject

#### Scenario: Broker runtime retrieves latest images on demand
- **WHEN** the singleton broker owns Telegram polling and the authorized Telegram user requests latest images
- **THEN** the broker requests the latest bounded image list from the session-owning Pi client and sends those images using the same validation rules as the in-process runtime

#### Scenario: Broker runtime sends a validated workspace image path
- **WHEN** the singleton broker owns Telegram polling and the authorized Telegram user invokes an explicit image-send command
- **THEN** the broker asks the session-owning Pi client to validate and load the image bytes, then sends the image using the same document transport as in-process runtime

#### Scenario: Broker image request targets offline session
- **WHEN** the authorized Telegram user requests latest images for a bound session that is currently offline
- **THEN** the broker reports that the session is offline and does not silently drop the request
