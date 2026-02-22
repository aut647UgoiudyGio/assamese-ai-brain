require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// --- কনফিগাৰেশ্যন ---
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "API_KEY_MISSING";
const MONGODB_URI = process.env.MONGODB_URI || "MONGO_URI_MISSING";

// --- ১. Google Gemini সেটআপ ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- ২. Brain JSON ফাইল লোড ---
const brainData = JSON.parse(fs.readFileSync('./brain.json', 'utf-8'));

// --- ৩. MongoDB সংযোগ ---
// Timeout কমাই দিয়া হৈছে যাতে ডাটাবেছত সমস্যা থাকিলে সোনকালে ধৰিব পাৰি
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  wallet_balance: { type: Number, default: 50 }
});

const User = mongoose.model('User', userSchema);

// --- ৪. API Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { userId, message } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ error: "User ID আৰু Message প্ৰয়োজন।" });
    }

    try {
        let user;
        // ডাটাবেছৰ সমস্যা পৰীক্ষা কৰা
        try {
            user = await User.findOne({ userId });
            if (!user) {
                user = new User({ userId, wallet_balance: 50 });
                await user.save();
            }
        } catch (dbError) {
            console.error("MongoDB Error:", dbError);
            return res.status(500).json({ 
                response: `🔴 **ডাটাবেছ এৰৰ (MongoDB):** ${dbError.message}\n\n**সমাধান:** অনুগ্ৰহ কৰি MongoDB Atlas ত গৈ 'Network Access' ত IP Address টো \`0.0.0.0/0\` দিয়া আছেনে পৰীক্ষা কৰক। লগতে Render-ত MONGODB_URI ঠিককৈ দিয়া আছেনে চাওক।` 
            });
        }

        let matchedIntent = null;
        const intents = brainData.intents;

        for (let intent of intents) {
            if (intent.intent_id === "system_fallback_unknown_999") continue;
            
            const isMatch = intent.patterns.some(pattern => message.toLowerCase().includes(pattern.toLowerCase()));
            if (isMatch) {
                matchedIntent = intent;
                break;
            }
        }

        if (matchedIntent) {
            return res.json({
                source: "json_brain",
                response: matchedIntent.response,
                detailed_response: matchedIntent.detailed_response,
                cost: 0,
                remaining_balance: user.wallet_balance
            });
        }

        const dynamicEngine = brainData.dynamic_knowledge_retrieval_engine;
        
        if (dynamicEngine && dynamicEngine.enabled) {
            const costPerRequest = 100;
            
            if (user.wallet_balance < costPerRequest) {
                return res.json({
                    source: "system",
                    response: "আপোনাৰ AI Coins শেষ হৈছে। অনুগ্ৰহ কৰি এটা বিজ্ঞাপন চাই টোকেন ৰিচাৰ্জ কৰক।",
                    action_required: "watch_ad"
                });
            }

            // Gemini AI ৰ সমস্যা পৰীক্ষা কৰা
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                
                const advancedPrompt = `You are Assamese AI Brain Pro, a highly advanced AI assistant. You are an expert in all programming languages (Python, HTML, JavaScript, C++, etc.), mathematics, and complex logical reasoning. 
Always provide detailed, professional, and accurate answers. 
When providing code, always use Markdown formatting (e.g., \`\`\`html ... \`\`\`). 
Answer in pure Assamese unless the user explicitly asks for English code.

Context from system: ${dynamicEngine.fallback_prompt_injection}

User Question: ${message}`;

                const result = await model.generateContent(advancedPrompt);
                const aiResponse = await result.response.text();

                user.wallet_balance -= costPerRequest;
                await user.save();

                return res.json({
                    source: "gemini_api",
                    response: aiResponse,
                    cost: costPerRequest,
                    remaining_balance: user.wallet_balance
                });
            } catch (aiError) {
                console.error("Gemini Error:", aiError);
                return res.status(500).json({ 
                    response: `🔴 **Gemini AI এৰৰ:** ${aiError.message}\n\n**সমাধান:** অনুগ্ৰহ কৰি Render-ৰ 'Environment Variables' ত গৈ \`GEMINI_API_KEY\` টো শুদ্ধকৈ দিয়া আছেনে পৰীক্ষা কৰক।` 
                });
            }
        }

        return res.json({
            source: "system_fallback",
            response: "দুখিত, মই আপোনাৰ প্ৰশ্নটো বুজি নাপালোঁ।"
        });

    } catch (error) {
        console.error("General Server Error:", error);
        return res.status(500).json({ response: `🔴 **অজ্ঞাত ছাৰ্ভাৰ এৰৰ:** ${error.message}` });
    }
});

app.post('/api/reward', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        let user = await User.findOne({ userId });
        if (user) {
            user.wallet_balance += amount;
            await user.save();
            res.json({ success: true, new_balance: user.wallet_balance });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error updating balance" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
