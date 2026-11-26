(() => {
    const BASE_WIDTH = 800;
    const BASE_HEIGHT = 600;
    const form = document.getElementById('setupForm');
    const generateButton = document.getElementById('generateButton');
    const notice = document.getElementById('notice');
    const playArea = document.getElementById('playArea');
    const answerArea = document.getElementById('answerArea');
    const drawingCanvas = document.getElementById('drawingCanvas');
    const drawingContext = drawingCanvas.getContext('2d');
    const RECENT_TOPICS_KEY = 'oekakiRecentTopics';
    const RECENT_GENRES_KEY = 'oekakiRecentGenres';
    const TOPICS_BY_GENRE = {
        '動物': ['ねこ', 'いぬ', 'うさぎ', 'くま', 'パンダ', 'ぞう', 'きりん', 'ペンギン'],
        '食べもの': ['りんご', 'いちご', 'バナナ', 'ケーキ', 'アイスクリーム', 'おにぎり', 'すし', 'ドーナツ'],
        '乗りもの': ['車', '電車', 'バス', '飛行機', '船', '自転車'],
        '海のいきもの': ['くじら', 'イルカ', 'たこ', 'かに', 'さかな', 'かめ', 'ひとで'],
        '自然や季節': ['太陽', '雲', '虹', 'ひまわり', 'さくら', '木', '雪だるま', '月']
    };
    const RANDOM_GENRES = Object.keys(TOPICS_BY_GENRE);
    const strokes = [];
    let gameData = null;
    let songIndex = 0;
    let currentStroke = null;
    let activeTool = 'pen';

    form.addEventListener('submit', makeDrawingSong);
    document.getElementById('previousLine').addEventListener('click', () => setSongIndex(songIndex - 1));
    document.getElementById('nextLine').addEventListener('click', advanceSong);
    document.getElementById('revealEarly').addEventListener('click', revealAnswer);
    document.getElementById('newRound').addEventListener('click', resetRound);
    document.getElementById('undoButton').addEventListener('click', undoStroke);
    document.getElementById('clearButton').addEventListener('click', clearDrawing);
    document.getElementById('penTool').addEventListener('click', () => setTool('pen'));
    document.getElementById('eraserTool').addEventListener('click', () => setTool('eraser'));
    document.getElementById('downloadButton').addEventListener('click', downloadDrawing);
    document.getElementById('brushColor').addEventListener('input', () => {
        document.querySelectorAll('.color-swatch').forEach(swatch => swatch.classList.remove('selected'));
    });
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.getElementById('brushColor').value = swatch.dataset.color;
            document.querySelectorAll('.color-swatch').forEach(option => option.classList.toggle('selected', option === swatch));
        });
    });
    document.getElementById('brushSize').addEventListener('input', event => {
        document.getElementById('brushSizeValue').textContent = event.target.value;
    });

    drawingCanvas.addEventListener('pointerdown', startStroke);
    drawingCanvas.addEventListener('pointermove', continueStroke);
    drawingCanvas.addEventListener('pointerup', finishStroke);
    drawingCanvas.addEventListener('pointercancel', finishStroke);
    drawingCanvas.addEventListener('lostpointercapture', finishStroke);

    async function makeDrawingSong(event) {
        event.preventDefault();
        const formData = new FormData(form);
        setLoading(true);
        showNotice('AIが絵描き歌とお手本をつくっています…', false);
        playArea.hidden = true;
        answerArea.hidden = true;

        try {
            const recentTopics = readRecentList(RECENT_TOPICS_KEY).slice(-10);
            const recentGenres = readRecentList(RECENT_GENRES_KEY).slice(-4);
            const selectedGenre = formData.get('genre');
            const genre = selectedGenre === 'おまかせ' ? chooseRandomGenre(recentGenres) : selectedGenre;
            const requestData = {
                title: 'AI 絵描き歌',
                genre,
                difficulty: formData.get('difficulty'),
                avoidTopics: recentTopics.join('、') || 'まだありません',
                variationSeed: makeVariationSeed()
            };

            gameData = await requestGame(requestData);
            if (shouldRegenerateTopic(gameData?.topic, recentTopics, genre)) {
                const firstTopic = gameData?.topic || '';
                requestData.avoidTopics = [...recentTopics, gameData.topic].join('、');
                requestData.variationSeed = makeVariationSeed();
                gameData = await requestGame(requestData);
                if (shouldRegenerateTopic(gameData?.topic, [...recentTopics, firstTopic], genre)) {
                    if (firstTopic) rememberTopic(firstTopic);
                    if (gameData?.topic) rememberTopic(gameData.topic);
                    throw new Error('定番のお題を選べませんでした。もう一度「絵描き歌をつくる」を押してください。');
                }
            }
            validateGameData(gameData);
            rememberTopic(gameData.topic);
            rememberGenre(genre);
            songIndex = 0;
            strokes.splice(0, strokes.length);
            redrawDrawing();
            renderSongLine();
            notice.hidden = true;
            playArea.hidden = false;
            playArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            showNotice(error.message || '通信に失敗しました。少し待ってからもう一度お試しください。', true);
        } finally {
            setLoading(false);
        }
    }

    async function requestGame(requestData) {
        const response = await fetch('/api/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || '絵描き歌をつくれませんでした。');
        return responseData.data?.[0];
    }

    function readRecentList(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
        } catch (error) {
            return [];
        }
    }

    function chooseRandomGenre(recentGenres) {
        const freshGenres = RANDOM_GENRES.filter(genre => !recentGenres.includes(genre));
        const options = freshGenres.length ? freshGenres : RANDOM_GENRES;
        return options[Math.floor(Math.random() * options.length)];
    }

    function makeVariationSeed() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function normalizeTopic(topic) {
        return String(topic || '').toLocaleLowerCase('ja').replace(/[\s・　]/g, '');
    }

    function shouldRegenerateTopic(topic, recentTopics, genre) {
        const normalizedTopic = normalizeTopic(topic);
        if (!normalizedTopic) return false;
        const allowedTopics = TOPICS_BY_GENRE[genre] || [];
        if (!allowedTopics.some(candidate => normalizeTopic(candidate) === normalizedTopic)) return true;
        const owlTerms = ['フクロウ', 'ふくろう', '梟', 'ミミズク', 'みみずく'];
        if (owlTerms.some(term => normalizedTopic.includes(normalizeTopic(term)))) return true;
        const normalizedRecent = recentTopics.map(normalizeTopic).filter(Boolean);
        return normalizedRecent.some(previous => previous === normalizedTopic || previous.includes(normalizedTopic) || normalizedTopic.includes(previous));
    }

    function rememberTopic(topic) {
        saveRecentList(RECENT_TOPICS_KEY, [...readRecentList(RECENT_TOPICS_KEY), topic].slice(-10));
    }

    function rememberGenre(genre) {
        saveRecentList(RECENT_GENRES_KEY, [...readRecentList(RECENT_GENRES_KEY), genre].slice(-4));
    }

    function saveRecentList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
        } catch (error) {
            // Private browsing settings may disable local storage; the current round can still run.
        }
    }

    function validateGameData(game) {
        if (!game || typeof game.topic !== 'string' || !game.topic.trim()) {
            throw new Error('お題のデータが見つかりません。もう一度つくってください。');
        }
        if (!Array.isArray(game.song) || game.song.length < 3 || game.song.length > 10 || game.song.some(step => !step || typeof step.line !== 'string')) {
            throw new Error('絵描き歌の形式が正しくありません。もう一度つくってください。');
        }
        if (!Array.isArray(game.shapes) || game.shapes.length < 1 || game.shapes.length > 40 || game.shapes.some(shape => !isValidShape(shape))) {
            throw new Error('お手本の図形データが正しくありません。もう一度つくってください。');
        }
    }

    function isValidShape(shape) {
        if (!shape || !['circle', 'ellipse', 'line', 'triangle', 'rect'].includes(shape.type)) return false;
        if (!/^#[0-9a-f]{6}$/i.test(shape.fill) || !/^#[0-9a-f]{6}$/i.test(shape.stroke)) return false;
        if (!Number.isFinite(Number(shape.lineWidth)) || Number(shape.lineWidth) < 1 || Number(shape.lineWidth) > 30) return false;
        const fieldsByType = {
            circle: ['x', 'y', 'r'],
            ellipse: ['x', 'y', 'rx', 'ry'],
            line: ['x1', 'y1', 'x2', 'y2'],
            triangle: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'],
            rect: ['x', 'y', 'w', 'h']
        };
        return fieldsByType[shape.type].every(field => Number.isFinite(Number(shape[field])));
    }

    function renderSongLine() {
        const line = gameData.song[songIndex].line;
        document.getElementById('currentLyric').textContent = line;
        document.getElementById('songCounter').textContent = `${songIndex + 1} / ${gameData.song.length}`;
        document.getElementById('previousLine').disabled = songIndex === 0;
        const nextButton = document.getElementById('nextLine');
        nextButton.innerHTML = songIndex === gameData.song.length - 1
            ? 'お題を発表する <span aria-hidden="true">✦</span>'
            : '次の行へ <span aria-hidden="true">→</span>';

        const progress = document.getElementById('songProgress');
        progress.replaceChildren();
        gameData.song.forEach((step, index) => {
            const marker = document.createElement('span');
            if (index < songIndex) marker.className = 'passed';
            if (index === songIndex) marker.className = 'active';
            progress.appendChild(marker);
        });

        const encouragement = document.getElementById('songEncouragement');
        encouragement.textContent = songIndex === gameData.song.length - 1
            ? 'さいごの行です。描き終わったら答えを見てみよう。'
            : '歌のとおりに、自由に描いてみてね。';
    }

    function setSongIndex(index) {
        if (!gameData) return;
        songIndex = Math.max(0, Math.min(gameData.song.length - 1, index));
        renderSongLine();
    }

    function advanceSong() {
        if (songIndex < gameData.song.length - 1) setSongIndex(songIndex + 1);
        else revealAnswer();
    }

    function startStroke(event) {
        if (!gameData || event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault();
        drawingCanvas.setPointerCapture(event.pointerId);
        currentStroke = {
            color: document.getElementById('brushColor').value,
            size: Number(document.getElementById('brushSize').value),
            tool: activeTool,
            points: [canvasPoint(event)]
        };
        strokes.push(currentStroke);
        redrawDrawing();
    }

    function continueStroke(event) {
        if (!currentStroke) return;
        event.preventDefault();
        currentStroke.points.push(canvasPoint(event));
        redrawDrawing();
    }

    function finishStroke() { currentStroke = null; }

    function canvasPoint(event) {
        const bounds = drawingCanvas.getBoundingClientRect();
        return {
            x: (event.clientX - bounds.left) * BASE_WIDTH / bounds.width,
            y: (event.clientY - bounds.top) * BASE_HEIGHT / bounds.height
        };
    }

    function redrawDrawing() {
        drawingContext.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        strokes.forEach(stroke => {
            const first = stroke.points[0];
            if (!first) return;
            drawingContext.save();
            drawingContext.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
            drawingContext.strokeStyle = stroke.color;
            drawingContext.fillStyle = stroke.color;
            drawingContext.lineWidth = stroke.size;
            drawingContext.lineCap = 'round';
            drawingContext.lineJoin = 'round';
            drawingContext.beginPath();
            drawingContext.moveTo(first.x, first.y);
            if (stroke.points.length === 1) {
                drawingContext.lineTo(first.x + 0.1, first.y + 0.1);
            } else {
                stroke.points.slice(1).forEach(point => drawingContext.lineTo(point.x, point.y));
            }
            drawingContext.stroke();
            drawingContext.restore();
        });
    }

    function setTool(tool) {
        activeTool = tool;
        document.getElementById('penTool').classList.toggle('selected', tool === 'pen');
        document.getElementById('eraserTool').classList.toggle('selected', tool === 'eraser');
    }

    function undoStroke() {
        if (strokes.length) strokes.pop();
        redrawDrawing();
    }

    function clearDrawing() {
        strokes.splice(0, strokes.length);
        redrawDrawing();
    }

    function revealAnswer() {
        if (!gameData) return;
        drawTarget(gameData.shapes);
        const resultCanvas = document.getElementById('myResultCanvas');
        const resultContext = resultCanvas.getContext('2d');
        resultContext.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        resultContext.drawImage(drawingCanvas, 0, 0);
        document.getElementById('answerTopic').textContent = `今日のお題は「${gameData.topic}」！`;
        document.getElementById('answerNote').textContent = gameData.answer_note || '歌に出てきた形がお手本のどこにあるか、見比べてみよう。';
        playArea.hidden = true;
        answerArea.hidden = false;
        answerArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function drawTarget(shapes) {
        const canvas = document.getElementById('targetCanvas');
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        context.save();
        context.lineCap = 'round';
        context.lineJoin = 'round';

        shapes.forEach(shape => {
            context.beginPath();
            context.fillStyle = shape.fill;
            context.strokeStyle = shape.stroke;
            context.lineWidth = Number(shape.lineWidth) * Math.min(BASE_WIDTH, BASE_HEIGHT) / 1000;

            if (shape.type === 'circle') {
                context.arc(scaleX(shape.x), scaleY(shape.y), scaleRadius(shape.r), 0, Math.PI * 2);
            } else if (shape.type === 'ellipse') {
                context.ellipse(scaleX(shape.x), scaleY(shape.y), scaleX(shape.rx), scaleY(shape.ry), 0, 0, Math.PI * 2);
            } else if (shape.type === 'line') {
                context.moveTo(scaleX(shape.x1), scaleY(shape.y1));
                context.lineTo(scaleX(shape.x2), scaleY(shape.y2));
            } else if (shape.type === 'triangle') {
                context.moveTo(scaleX(shape.x1), scaleY(shape.y1));
                context.lineTo(scaleX(shape.x2), scaleY(shape.y2));
                context.lineTo(scaleX(shape.x3), scaleY(shape.y3));
                context.closePath();
            } else if (shape.type === 'rect') {
                context.rect(scaleX(shape.x), scaleY(shape.y), scaleX(shape.w), scaleY(shape.h));
            }

            if (shape.type !== 'line') context.fill();
            context.stroke();
        });
        context.restore();
    }

    function scaleX(value) { return clamp(value) * BASE_WIDTH / 1000; }
    function scaleY(value) { return clamp(value) * BASE_HEIGHT / 1000; }
    function scaleRadius(value) { return Math.max(1, clamp(value) * Math.min(BASE_WIDTH, BASE_HEIGHT) / 1000); }
    function clamp(value) { return Math.max(0, Math.min(1000, Number(value))); }

    function downloadDrawing() {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = BASE_WIDTH;
        exportCanvas.height = BASE_HEIGHT;
        const context = exportCanvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        context.drawImage(drawingCanvas, 0, 0);
        exportCanvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'my-drawing.png';
            link.click();
            URL.revokeObjectURL(url);
        }, 'image/png');
    }

    function resetRound() {
        gameData = null;
        playArea.hidden = true;
        answerArea.hidden = true;
        notice.hidden = true;
        clearDrawing();
        document.getElementById('setupCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setLoading(isLoading) {
        generateButton.disabled = isLoading;
        generateButton.querySelector('span:first-child').textContent = isLoading ? 'うたを考えています…' : '絵描き歌をつくる';
    }

    function showNotice(message, isError) {
        notice.textContent = message;
        notice.classList.toggle('is-error', isError);
        notice.hidden = false;
    }
})();
