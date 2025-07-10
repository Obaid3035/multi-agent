# 📞 Voice Campaign Manager using ElevenLabs Conversational Agents

This Node.js application automates outbound voice campaigns using ElevenLabs' Conversational AI. It supports dynamic agent-based interactions, conversation outcome evaluation, retries for missed calls, and auto-transfer to a second agent upon success.

---

## ✅ Features

- Use of ElevenLabs conversational agents
- Agent delegation and transfer support
- Configurable max call attempts and retry delays
- Transcript-based call outcome evaluation
- Campaign logging and final report generation
- Concurrent call batch execution

---

## 🛠 Setup Instructions

### 1. Install Dependencies

```bash
npm install
node index.js
```



### 2. Configure environment variables

Create a `.env` file:

ELEVENLABS_API_KEY=your_elevenlabs_api_key
SCREENING_AGENT_ID=your_screening_agent_id
TRANSFER_AGENT_ID=your_transfer_agent_id
VOICE_ID=your_voice_id
RETRY_DELAY_MS=delays

### 3. Create campaign configuration

Create `config/campaign_config.json`:

```json
{
  "campaignName": "July Outreach Campaign",
  "maxAttempts": 3,
  "retryDelay": 60000,
  "concurrentCalls": 2,
  "batchDelay": 5000,
  "maxCallDuration": 300
}

### 4. Add customer list

Create `data/customers.json`:

```json
[
  {
    "id": 1,
    "name": "Alice",
    "phone": "+1234567890"
  },
  {
    "id": 2,
    "name": "Bob",
    "phone": "+1987654321"
  }
]
```
### Output
- Logs saved to the logs/ directory
- Final campaign report saved to reports/ directory

### Call Evaluation Logic
The evaluation function analyzes the last user and agent messages in the transcript.

- Outcome is determined by keyword presence:

    - Success indicators: "yes", "interested", "schedule", etc.

    - Retry indicators: "not home", "call back", "later"

    - No answer: "voicemail", "no response", or very short transcript

#### Example result structure:

```json
{
  "status": "success",
  "reason": "Customer showed interest",
  "shouldRetry": false,
  "shouldTransfer": true
}
```
### Retry Logic
- Each customer is retried up to the configured number of attempts

- Retries are delayed based on retryDelay in the config

- Retries are handled in the same process unless replaced with a job scheduler

### API Endpoints Used
- POST /convai/twilio/outbound-call – initiates the call

- GET /convai/conversations/:conversation_id – monitors call status

### Future Improvements
- Use OpenAI or ElevenLabs NLP for better transcript evaluation

- Implement background job queue instead of in-process delay

- Build a dashboard UI to manage campaigns and view results

### Notes
- Agent transfer is handled via ElevenLabs platform configuration

- Logs and reports are saved as JSON files in local folders

