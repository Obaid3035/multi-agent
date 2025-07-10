const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class VoiceCampaignManager {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.elevenlabs.io/v1';
        this.headers = {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
        };
        this.campaigns = new Map();
        this.callAttempts = new Map();
    }

    async loadCampaignConfig(configPath) {
        try {
            const configData = await fs.readFile(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('Error loading campaign config:', error.message);
            throw error;
        }
    }

    async loadCustomerList(customerListPath) {
        try {
            const customerData = await fs.readFile(customerListPath, 'utf8');
            return JSON.parse(customerData);
        } catch (error) {
            console.error('Error loading customer list:', error.message);
            throw error;
        }
    }

    async makeCall(agentId, customer, config, attemptNumber = 1) {
        
        try {
            
            console.log(`📞 Calling ${customer.name} (${customer.phone}) - Attempt ${attemptNumber}/${config.maxAttempts}`);
        
    

            const response = await axios.post(
                `${this.baseURL}/convai/twilio/outbound-call`,
               {
                    agent_id: agentId,
                    agent_phone_number_id: "phnum_01jzrntv9kexrrwceyx2c046qy",
                    to_number: customer.phone
                },
                { headers: this.headers }
            );

            const conversationId = response.data.conversation_id;
            console.log(`✅ Call initiated - Conversation ID: ${conversationId}`);

            const callResult = await this.monitorCall(conversationId, config.maxCallDuration || 300);
            
            await this.logCallResult(customer, callResult, attemptNumber);

            return callResult;

        } catch (error) {
            console.error(`❌ Error calling ${customer.name}:`, error.response?.data || error.message);
            
            // Log failed call
            await this.logCallResult(customer, {
                status: 'failed',
                error: error.message,
                timestamp: new Date().toISOString()
            }, attemptNumber);

            return {
                status: 'failed',
                error: error.message,
                shouldRetry: true
            };
        }
    }

    async monitorCall(conversationId, maxDuration) {
        const startTime = Date.now();
        const pollInterval = 5000; // Poll every 5 seconds

        console.log(`⏳ Monitoring call status for Conversation ID: ${conversationId}`);
        
        while (Date.now() - startTime < maxDuration * 1000) {
            try {
                const response = await axios.get(
                    `${this.baseURL}/convai/conversations/${conversationId}`,
                    { headers: this.headers }
                );

                const conversation = response.data;

                console.log(`📞 Call status: ${conversation.status} - Last message: ${conversation.last_message?.content || 'N/A'}`);
                
                if (conversation.status === 'completed' || conversation.status === 'ended') {
                    return await this.determineCallOutcome(conversation);
                }

                if (conversation.status === 'failed' || conversation.status === 'error') {
                    return {
                        status: 'failed',
                        reason: conversation.error || 'Call failed',
                        shouldRetry: true,
                        timestamp: new Date().toISOString()
                    };
                }

                await this.sleep(pollInterval);

            } catch (error) {
                console.error('Error monitoring call:', error.message);
                await this.sleep(pollInterval);
            }
        }

        return {
            status: 'timeout',
            reason: 'Call exceeded maximum duration',
            shouldRetry: true,
            timestamp: new Date().toISOString()
        };
    }

    determineCallOutcome(conversation) {
    const transcript = conversation.transcript || [];
    const callDuration = conversation.duration || 0;
    
    // Very basic checks - the real intelligence is in ElevenLabs tools
    
    if (transcript.length < 2 || callDuration < 5) {
        return {
            status: 'no_answer',
            reason: 'No one answered or call was too short',
            shouldRetry: true,
            shouldTransfer: false,
            transcript: transcript,
            timestamp: new Date().toISOString()
        };
    }
    
    return {
        status: 'completed',
        reason: 'Call completed - outcome determined by ElevenLabs tools',
        shouldRetry: false, 
        shouldTransfer: false, 
        transcript: transcript,
        duration: callDuration,
        timestamp: new Date().toISOString()
    };
}

    async runCustomerCampaign(customer, config, screeningAgentId, transferAgentId) {
        const customerKey = `${customer.phone}_${customer.id || customer.name}`;
        
        if (!this.callAttempts.has(customerKey)) {
            this.callAttempts.set(customerKey, 0);
        }

        let attempts = this.callAttempts.get(customerKey);
        
        while (attempts < config.maxAttempts) {
            attempts++;
            this.callAttempts.set(customerKey, attempts);
            
            const result = await this.makeCall(screeningAgentId, customer, config, attempts);
            
            if (!result.shouldRetry) {
                console.log(`❌ Campaign completed for ${customer.name} - ${result.reason}`);
                return { status: 'completed', outcome: result.status };
            }
            
            if (attempts < config.maxAttempts) {
                console.log(`⏳ Waiting ${config.retryDelay}ms before next attempt for ${customer.name}`);
                // This will result in memory leak, So try a solution including cronjob
                await this.sleep(config.retryDelay);
            }
        }
        
        console.log(`❌ Campaign failed for ${customer.name} - Max attempts reached`);
        return { status: 'failed', outcome: 'max_attempts_reached' };
    }

    async runCampaign(configPath, customerListPath) {
        try {
            console.log('🚀 Starting voice campaign...');
            
            const config = await this.loadCampaignConfig(configPath);
            const customers = await this.loadCustomerList(customerListPath);
            
            console.log(`📋 Campaign: ${config.campaignName}`);
            console.log(`👥 Customers: ${customers.length}`);
            console.log(`📞 Max attempts per customer: ${config.maxAttempts}`);
            console.log(`⏱️ Retry delay: ${config.retryDelay}ms`);
            
            // Create agents
            const screeningAgentId = process.env.SCREENING_AGENT_ID;
            const transferAgentId = process.env.TRANSFER_AGENT_ID;
            
            const results = [];
            const concurrentCalls = config.concurrentCalls || 1;
            
            for (let i = 0; i < customers.length; i += concurrentCalls) {
                const batch = customers.slice(i, i + concurrentCalls);
                
                const batchPromises = batch.map(customer => 
                    this.runCustomerCampaign(customer, config, screeningAgentId, transferAgentId)
                        .then(result => ({ customer, result }))
                        .catch(error => ({ customer, result: { status: 'error', error: error.message } }))
                );
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                
                if (i + concurrentCalls < customers.length) {
                    await this.sleep(config.batchDelay || 5000);
                }
            }
            
            await this.generateCampaignReport(config, results);
            
            console.log('🎉 Campaign completed!');
            return results;
            
        } catch (error) {
            console.error('❌ Campaign failed:', error.message);
            throw error;
        }
    }

    async logCallResult(customer, result, attemptNumber) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            customer: customer,
            attempt: attemptNumber,
            result: result
        };
        
        const logPath = path.join(__dirname, 'logs', `call_log_${new Date().toISOString().split('T')[0]}.json`);
        
        try {
            await fs.mkdir(path.dirname(logPath), { recursive: true });
            let logs = [];
            const existingLogs = await fs.readFile(logPath, 'utf8');
            logs = JSON.parse(existingLogs);
            logs.push(logEntry);
            await fs.writeFile(logPath, JSON.stringify(logs, null, 2));
            
        } catch (error) {
            console.error('Error logging call result:', error.message);
        }
    }

    async generateCampaignReport(config, results) {
        const report = {
            campaignName: config.campaignName,
            startTime: new Date().toISOString(),
            totalCustomers: results.length,
            successful: results.filter(r => r.result.outcome === 'transferred').length,
            failed: results.filter(r => r.result.status === 'failed').length,
            notInterested: results.filter(r => r.result.outcome === 'not_interested').length,
            noAnswer: results.filter(r => r.result.outcome === 'no_answer').length,
            results: results
        };
        
        const reportPath = path.join(__dirname, 'reports', `campaign_report_${Date.now()}.json`);
        
        try {
            await fs.mkdir(path.dirname(reportPath), { recursive: true });
            await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
            console.log(`📊 Campaign report saved to: ${reportPath}`);
        } catch (error) {
            console.error('Error generating campaign report:', error.message);
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = VoiceCampaignManager;

if (require.main === module) {
    const main = async () => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            console.error('Please set ELEVENLABS_API_KEY in your environment variables');
            process.exit(1);
        }

        const campaignManager = new VoiceCampaignManager(apiKey);
        
        try {
            await campaignManager.runCampaign(
                './config/campaign_config.json',
                './data/customers.json'
            );
        } catch (error) {
            console.error('Campaign failed:', error.message);
            process.exit(1);
        }
    };

    main();
}