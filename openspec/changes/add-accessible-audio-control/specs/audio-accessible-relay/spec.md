## ADDED Requirements

### Requirement: Audio-first relay mode
The system SHALL provide an opt-in audio-first relay mode for authorized users who prefer or require speech-based interaction.

#### Scenario: Authorized user enables audio mode
- **WHEN** an authorized user enables audio-first mode for a paired session or channel identity
- **THEN** the system records non-secret audio preferences and uses spoken responses for supported events according to those preferences

#### Scenario: Channel cannot send audio
- **WHEN** audio-first mode is enabled but the active channel adapter cannot send audio responses
- **THEN** the system falls back to accessible text transcripts and explains the channel limitation

#### Scenario: Binding is restored
- **WHEN** a paired session resumes with saved non-secret audio preferences
- **THEN** the system restores audio mode preferences without storing STT or TTS provider secrets in session history

### Requirement: Speech-to-text input processing
The system SHALL convert authorized voice or supported audio input into transcripts before resolving it as a prompt or relay command.

#### Scenario: Authorized voice prompt is transcribed
- **WHEN** an authorized user sends voice input while the paired session is online, unpaused, and audio input is configured
- **THEN** the system downloads the audio after authorization, transcribes it, and records or sends an auditable transcript of what was understood

#### Scenario: Transcription backend is unavailable
- **WHEN** an authorized user sends voice input but no configured transcription backend is available
- **THEN** the system rejects the audio input with setup guidance and does not inject an empty or guessed prompt

#### Scenario: Unauthorized voice input is received
- **WHEN** an unbound or unauthorized user sends voice or audio media to a channel adapter
- **THEN** the system rejects the update before downloading or transcribing the audio

#### Scenario: Transcription confidence is low or ambiguous
- **WHEN** transcription or command recognition is below the configured confidence threshold or matches multiple sensitive intents
- **THEN** the system asks for clarification or confirmation instead of injecting the transcript or executing the command

### Requirement: Voice command resolution
The system SHALL resolve common spoken phrases into relay commands and guided-answer actions without forwarding raw command phrases to the model.

#### Scenario: User asks for status by voice
- **WHEN** an authorized user says a recognized status phrase such as “status” or “what is happening”
- **THEN** the system returns the current session status through spoken output or accessible text fallback without injecting the phrase into Pi

#### Scenario: User chooses an answer option by voice
- **WHEN** an authorized user says a recognized option phrase such as “option one” or “choose B” for the latest current guided answer
- **THEN** the system injects the selected answer using existing guided-answer delivery rules and acknowledges the selection

#### Scenario: User requests readback by voice
- **WHEN** an authorized user says a recognized readback phrase such as “read last”, “repeat answer”, or “read choices”
- **THEN** the system returns an audio-friendly rendering of the requested current output or choices

#### Scenario: Spoken command is stale
- **WHEN** an authorized user speaks a command that references expired or no-longer-current answer, approval, or output state
- **THEN** the system rejects the stale action and explains what current actions are available

### Requirement: Spoken output rendering
The system SHALL render selected relay outputs into concise, audio-friendly speech text before synthesis.

#### Scenario: Completion summary is spoken
- **WHEN** a Pi turn completes for a user with audio completion notifications enabled
- **THEN** the system renders a concise spoken summary of the latest assistant output and sends it as audio or accessible text fallback

#### Scenario: Output contains structured choices
- **WHEN** the latest assistant output contains reliable guided-answer choices and audio mode is enabled
- **THEN** the system clearly speaks the prompt and each stable option identifier so the user can answer by voice

#### Scenario: Output contains code, diffs, logs, or tables
- **WHEN** spoken output rendering encounters code blocks, diffs, logs, stack traces, or Markdown tables
- **THEN** the system summarizes their type, size, and important safe details instead of reading raw content aloud by default

#### Scenario: User explicitly requests more detail
- **WHEN** an authorized user requests more detail for the latest spoken output
- **THEN** the system provides a more detailed audio-friendly rendering only for content classified as safe for spoken delivery

### Requirement: Text-to-speech delivery
The system SHALL synthesize spoken responses through a configured TTS backend while preserving text transcript fallbacks.

#### Scenario: TTS backend is configured
- **WHEN** the system has safe spoken text to deliver and a TTS backend is configured
- **THEN** it synthesizes an audio response within configured size and duration limits and sends it through the active channel when supported

#### Scenario: TTS backend fails
- **WHEN** TTS synthesis fails or the generated audio exceeds configured limits
- **THEN** the system sends the accessible text transcript fallback and reports that audio generation failed

#### Scenario: User requests transcript
- **WHEN** an authorized user requests the transcript for the latest spoken response
- **THEN** the system sends the text version that was used or intended for speech synthesis after redaction

### Requirement: Audio safety and privacy boundaries
The system SHALL protect secrets and sensitive actions when processing audio input or generating spoken output.

#### Scenario: Spoken output contains redacted content
- **WHEN** assistant output or relay status contains configured secret patterns or content classified as unsafe for speech
- **THEN** the system redacts or omits that content before sending it to the TTS backend or channel

#### Scenario: Hidden content exists in session
- **WHEN** spoken readback is requested for a turn that involved hidden prompts, tool internals, or full session metadata
- **THEN** the system limits readback to safe assistant-facing or user-facing content and does not speak hidden internals

#### Scenario: Sensitive action is requested by voice
- **WHEN** an authorized user speaks a command for a sensitive action such as abort, approve, deny, push approval, or destructive-action approval
- **THEN** the system requires explicit confirmation using a clear confirmation phrase before resolving the action

#### Scenario: Audio artifacts are retained
- **WHEN** inbound transcripts, outbound spoken transcripts, or generated audio references are retained
- **THEN** the system applies configured retention limits and never persists provider secrets or raw pairing secrets in session history

### Requirement: Audio accessibility broker parity
The system SHALL provide equivalent audio accessibility behavior in both in-process and broker runtimes.

#### Scenario: Broker receives voice input
- **WHEN** the singleton broker owns channel polling and receives authorized voice input for an online session
- **THEN** the broker and session-owning client process normalized audio/transcript/intent data so behavior matches in-process runtime behavior

#### Scenario: Broker sends spoken output
- **WHEN** a broker-managed channel needs to send spoken output for a session event
- **THEN** it uses the same safe spoken text, TTS, transcript fallback, and channel capability rules as in-process runtime

#### Scenario: Audio action targets offline session
- **WHEN** a spoken command requires an online session but the selected session is offline
- **THEN** the system reports the offline state through spoken output or accessible text fallback and does not silently drop the command
