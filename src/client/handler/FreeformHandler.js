const axios = require('axios');
const supabase = require('../../utils/supabaseClient'); // Import the initialized Supabase client
const { v4: uuidv4 } = require('uuid'); // Import the uuid module

class FreeformHandler {
    constructor(client) {
        this.client = client;
    }

    async handleMessage(message) {
        try {
            const messageHistory = await this.fetchMessageHistory(message, 20);
            const responseContext = [{ role: 'system', content: 'You are Comet, an AI assistant obsessed with optimizing the user\'s productivity. Respond conversationally the users message. Draw them about about their values and motives behind tasks. Try to keep them on the topic of acheiving their goals. If there are unique tasks mentioned by the user, mention new tasks at the end of your message. "It seems like you\'ve identified some new tasks: Take out the trash, and clean the room. These align to your higher level goals because having a cleaner house will allow you to <...>."' }, ...messageHistory];

            const initialResponse = await this.sendToComet(responseContext);

            const classification = await this.classifyMessageContext(responseContext, initialResponse);
            await this.sendResponseToClient(message.channel, initialResponse, classification);

            const taskClassificationContext = await this.fetchMessageHistory(message, 5);
            if (classification === true) {
                const todoItems = await this.generateTodoItems(taskClassificationContext, initialResponse);
                await this.sendTodoItemsToClient(message.channel, todoItems);
                await this.saveTodoItemsToDatabase(message.author.id, todoItems);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            message.channel.send('There was an error processing your request.');
        }
    }

    async fetchMessageHistory(message, amount) {
        // Fetch the last 20 messages from the channel
        const messages = await message.channel.messages.fetch({ limit: amount });
        const messageHistory = messages.map(msg => ({
            role: msg.author.bot ? 'assistant' : 'user',
            content: msg.content
        })).reverse();

        return messageHistory;
    }

    async sendToComet(messageHistory) {
        const response = await axios.post('https://usecomet.app/gpt4-chat', {
            model: "gpt-4o",
            messages: messageHistory
        });
        return response.data.reply.choices[0].message.content;
    }

    async classifyMessageContext(messageHistory, initialResponse) {
        const classificationResponse = await axios.post('https://usecomet.app/classify-context', {
            messageHistory,
            response: initialResponse
        });
        return classificationResponse.data;
    }

    async sendResponseToClient(channel, response, classification) {
        await channel.send(response);
        if (classification === true) {
            await channel.send('Generating todo items...');
        } else {
            await channel.send('No todos required.');
        }
    }

    async generateTodoItems(messageHistory, initialResponse) {
        const todoResponse = await axios.post('https://usecomet.app/generate-todos', {
            messageHistory,
            response: initialResponse
        });
        return todoResponse.data.todos;
    }

    async sendTodoItemsToClient(channel, todoItems) {
        await channel.send(`Todo items: ${todoItems.join(', ')}`);
    }

    async saveTodoItemsToDatabase(userId, todoItems) {
        const userUUID = await this.getUserUUIDByDiscordId(userId);
        if (!userUUID) {
            throw new Error('Failed to fetch user UUID');
        }

        const { data, error } = await supabase
            .from('task_list')
            .insert(todoItems.map(item => ({
                user_id: userUUID,
                task: item
            })));

        if (error) {
            console.error('Error saving todo items to database:', error);
        }
    }

    async saveMessageToHistory(message, senderRole) {
        try {
            const userUUID = await this.getUserUUIDByDiscordId(message.author.id);
            if (!userUUID) {
                throw new Error('Failed to fetch user UUID');
            }

            const threadId = await this.getOrCreateThreadId(userUUID);
            if (!threadId) {
                throw new Error('Failed to get or create thread ID');
            }

            const { data, error } = await supabase
                .from('message_history')
                .insert([
                    {
                        user_id: userUUID, // Use the fetched user UUID
                        type: 'message',
                        text: message.content,
                        sender: senderRole,
                        thread_id: threadId
                    }
                ]);
            if (error) {
                console.error('Error saving message to database:', error);
            }
        } catch (error) {
            console.error("Error saving message:", error);
        }
    }

    async getUserUUIDByDiscordId(discordId) {
        try {
            // Ensure discordId is a string and trim any whitespace
            const trimmedDiscordId = discordId.toString().trim();
            console.log(`Fetching user UUID for Discord ID: ${trimmedDiscordId}`);

            const { data, error } = await supabase
                .from('user_profiles')
                .select('id')
                .eq('discord_id', trimmedDiscordId)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (!data) {
                console.error(`No user found with Discord ID: ${trimmedDiscordId}`);
                return null;
            }

            return data.id;
        } catch (error) {
            console.error('Error fetching user UUID:', error);
            return null;
        }
    }

    async getOrCreateThreadId(userId) {
        try {
            // Fetch the latest_thread from the user_profiles table
            const { data, error } = await supabase
                .from('user_profiles')
                .select('latest_thread')
                .eq('id', userId)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            let threadId = data ? data.latest_thread : null;

            // If no latest_thread, create a new one and update the user profile
            if (!threadId) {
                threadId = uuidv4(); // Generate a new UUID
                const { error: updateError } = await supabase
                    .from('user_profiles')
                    .update({ latest_thread: threadId })
                    .eq('id', userId);

                if (updateError) {
                    throw updateError;
                }
            }

            console.log('Thread ID:', threadId);
            return threadId;
        } catch (error) {
            console.error('Error managing thread ID:', error);
            return null;
        }
    }
}

module.exports = FreeformHandler;