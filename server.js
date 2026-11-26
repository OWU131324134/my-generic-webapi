const express = require('express');
const fs = require('fs');
// API Key などの環境変数は .env.local から読み込む
require('dotenv').config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// ===== 設定 =====
// 利用するLLMプロバイダを選択します（'openai' または 'gemini'）
const PROVIDER = 'openai';

// プロバイダごとに利用するモデル
const MODELS = {
    openai: 'gpt-6-luna',        // OpenAI（デフォルト）
    gemini: 'gemini-4-hydrogen', // Google Gemini
};
const MODEL = MODELS[PROVIDER];

let promptTemplate;
try {
    promptTemplate = fs.readFileSync('drawsong-prompt.md', 'utf8');
} catch (error) {
    console.error('Error reading drawsong-prompt.md:', error);
    process.exit(1);
}

const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

app.post('/api/', async (req, res) => {
    try {
        const { title = 'AI 絵描き歌', ...variables } = req.body;
        if (!['動物', '食べもの', '乗りもの', '海のいきもの', '自然や季節'].includes(variables.genre)) {
            return res.status(400).json({ error: 'genre must be a supported drawing category' });
        }
        if (!['かんたん', 'ふつう', 'むずかしめ'].includes(variables.difficulty)) {
            return res.status(400).json({ error: 'difficulty must be かんたん, ふつう, or むずかしめ' });
        }
        if (variables.avoidTopics !== undefined && (typeof variables.avoidTopics !== 'string' || variables.avoidTopics.length > 1000)) {
            return res.status(400).json({ error: 'avoidTopics must be a string under 1000 characters' });
        }
        if (variables.variationSeed !== undefined && (typeof variables.variationSeed !== 'string' || variables.variationSeed.length > 40)) {
            return res.status(400).json({ error: 'variationSeed must be a string under 40 characters' });
        }

        const finalPrompt = fillTemplate(promptTemplate, variables);

        let result;
        if (PROVIDER === 'openai') {
            result = await callOpenAI(finalPrompt, 8000);
        } else if (PROVIDER === 'gemini') {
            result = await callGemini(finalPrompt);
        } else {
            return res.status(400).json({ error: 'Invalid provider configuration' });
        }

        res.json({
            title: title,
            data: result,
        });

    } catch (error) {
        // 詳細はサーバーログにのみ出力し、クライアントには汎用メッセージを返す
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to generate content. Please try again.' });
    }
});

// プロンプト内の ${key} を variables の値で置換する
function fillTemplate(template, variables) {
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(variables, key)
            ? String(variables[key])
            : match; // 対応する値がなければそのまま残す
    });
}

async function callOpenAI(prompt, maxCompletionTokens = 2000) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const response = await fetch(OPENAI_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: prompt }
            ],
            max_completion_tokens: maxCompletionTokens,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
        throw new Error('OpenAI response did not contain a completion choice');
    }
    if (choice.finish_reason === 'length') {
        throw new Error(`OpenAI response was truncated at ${maxCompletionTokens} completion tokens`);
    }

    const responseText = choice.message?.content;
    if (!responseText) {
        throw new Error(`OpenAI returned an empty response (finish_reason: ${choice.finish_reason || 'unknown'})`);
    }
    return extractArray(responseText);
}

async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const response = await fetch(`${GEMINI_API_BASE_URL}${MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                // 思考型モデルでは思考トークンもこの上限に含まれるため、余裕を持たせる
                maxOutputTokens: 8192,
                response_mime_type: "application/json",
                // クイズ生成に深い思考は不要。HIGH（既定）だと思考で上限に達し JSON が途中で切れることがある
                thinkingConfig: { thinkingLevel: "LOW" }
            }
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Gemini API error');
    }

    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    return extractArray(responseText);
}

// LLM が返した JSON 文字列をパースし、最初に見つかった配列を取り出す
function extractArray(responseText) {
    let parsedData;
    try {
        parsedData = JSON.parse(responseText);
    } catch (parseError) {
        throw new Error('Failed to parse LLM response: ' + parseError.message);
    }

    const arrayData = Object.values(parsedData).find(Array.isArray);
    if (!arrayData) {
        throw new Error('No array found in the LLM response object.');
    }
    return arrayData;
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Config: ${PROVIDER} - ${MODEL}`);
});
