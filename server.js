require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// --- কনফিগাৰেশ্যন (Render-ৰ Environment Variable-ৰ পৰা লব) ---
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

// --- ১. Google Gemini সেটআপ ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- ২. Brain JSON ফাইল লোড ---
// (Brain ফাইলটো GitHub-ত কোডৰ লগত থাকিব, সেইবাবে ই Local File হিচাপে দ্ৰুতগতিত কাম কৰিব)
const brainData = JSON.parse(fs.readFileSync('./brain.json', 'utf-8'));

// --- ৩. MongoDB সংযোগ (User Data-ৰ বাবে) ---
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ইউজাৰৰ স্কিমা (User Schema) - MongoDB ত কি কি ডাটা থাকিব
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  wallet_balance: { type: Number, default: 50 } // নতুন ইউজাৰে ৫০ টোকেন পাব
});

const User = mongoose.model('User', userSchema);

// --- ৪. API Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { userId, message } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ error: "User ID আৰু Message প্ৰয়োজন।" });
    }

    try {
        // ক) MongoDB-ৰ পৰা ইউজাৰ বিচাৰক বা নতুনকৈ বনাওক
        let user = await User.findOne({ userId });
        if (!user) {
            user = new User({ userId, wallet_balance: 50 }); // নতুন ইউজাৰ সৃষ্টি
            await user.save();
        }

        // খ) প্ৰথমে JSON Brain-ত উত্তৰ বিচাৰক (Cost: 0)
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

        // গ) যদি JSON-ত নাই -> Gemini API Call (Cost: 100)
        const dynamicEngine = brainData.dynamic_knowledge_retrieval_engine;
        
        if (dynamicEngine && dynamicEngine.enabled) {
            const costPerRequest = 100;
            
            // টোকেন চেক
            if (user.wallet_balance < costPerRequest) {
                return res.json({
                    source: "system",
                    response: "আপোনাৰ AI Coins শেষ হৈছে। অনুগ্ৰহ কৰি এটা AdMob Rewarded Video চাই টোকেন ৰিচাৰ্জ কৰক।",
                    action_required: "watch_ad"
                });
            }

            // Gemini-লৈ মেছেজ পঠিয়াওক
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
            const promptContext = dynamicEngine.fallback_prompt_injection;
            const finalPrompt = `${promptContext}\n\nপ্ৰশ্ন: ${message}`;

            const result = await model.generateContent(finalPrompt);
            const aiResponse = await result.response.text();

            // MongoDB-ত টোকেন আপডেট কৰক
            user.wallet_balance -= costPerRequest;
            await user.save(); // ডাটাবেছত চেভ হ'ল

            return res.json({
                source: "gemini_api",
                response: aiResponse,
                cost: costPerRequest,
                remaining_balance: user.wallet_balance
            });
        }

        // Fallback
        return res.json({
            source: "system_fallback",
            response: "দুখিত, মই আপোনাৰ প্ৰশ্নটো বুজি নাপালোঁ।"
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Server Error" });
    }
});

// টোকেন ৰিচাৰ্জ কৰাৰ নতুন API (AdMob-ৰ পৰা Reward পালে এইটো কল কৰিব)
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
