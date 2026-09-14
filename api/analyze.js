const ANTHROPIC_MODEL = 'claude-sonnet-5';
const SYSTEM_PROMPT = 'あなたはウマ娘プリティーダービーの因子継承画面のスクリーンショットからデータを抽出するアシスタントです。JSONのみを返してください。前置き、説明、コードフェンスは一切不要です。スキーマ: {"character": string, "blue_factor": {"name": string, "level": number}, "red_factors": [{"name": string, "level": number}], "white_factors": [{"name": string, "level": number}]}。levelは星やゲージの数（1〜3程度）。読み取れない項目は空文字列または空配列にしてください。';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'サーバーにANTHROPIC_API_KEYが設定されていません。' });
    return;
  }

  const { mediaType, data } = req.body || {};
  if (!mediaType || !data) {
    res.status(400).json({ error: 'mediaTypeとdataは必須です。' });
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: 'この画像から因子情報を抽出してJSONで返して。' }
          ]
        }]
      })
    });

    const json = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: (json.error && json.error.message) || 'Anthropic APIエラー' });
      return;
    }
    res.status(200).json(json);
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
