# うたっておえかき

絵描き歌を見ながら自由に描いて、最後にAIのお手本と見比べるWebアプリです。トップページを開くと、そのまま遊べます。

## 遊び方

1. お題のジャンルと難易度を選び、「絵描き歌をつくる」を押します。
2. 歌詞を一行ずつ進めながら、キャンバスに絵を描きます。色・線の太さ、消しゴム、取り消し、PNG保存が使えます。
3. 最後の歌詞で答え合わせをすると、お題が明かされ、自分の絵とAIのお手本が並んで表示されます。

「おまかせ」はジャンルを回ごとに変え、ブラウザーに保存した直近のお題を避けます。

## 起動方法

```bash
npm install
```

`.env.local` に OpenAI API キーを設定します。

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=8080
```

サーバーを起動して `http://localhost:8080` を開きます。

```bash
npm start
```

API キーはサーバー側で使い、ブラウザーには公開しません。

## JSON 生成

ブラウザーから generic-webapi の `/api/` にジャンルと難易度を送り、[drawsong-prompt.md](drawsong-prompt.md) の指示で OpenAI API に JSON を生成させます。サーバーで `JSON.parse()` した後、歌詞と図形データをブラウザーに返します。図形データは円・楕円・線・三角形・四角形の命令で、Canvas にお手本として描画します。

```json
{
  "data": [
    {
      "topic": "お題の名前",
      "answer_note": "見比べるポイント",
      "song": [
        { "line": "まるをひとつ かきまして" }
      ],
      "shapes": [
        {
          "type": "ellipse",
          "x": 500,
          "y": 520,
          "rx": 250,
          "ry": 300,
          "fill": "#F4C95D",
          "stroke": "#493B32",
          "lineWidth": 9
        }
      ]
    }
  ]
}
```
