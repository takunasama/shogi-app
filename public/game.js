const socket = io();

// 駒の表示名
const PIECE_NAMES = {
  king: '王', rook: '飛', bishop: '角', gold: '金', silver: '銀',
  knight: '桂', lance: '香', pawn: '歩',
  dragon: '龍', horse: '馬',
  promoted_silver: '全', promoted_knight: '圭', promoted_lance: '杏', promoted_pawn: 'と'
};

// 状態
let myColor = null; // 'sente' or 'gote'
let myPlayerIndex = null; // 0 or 1
let currentBoard = null;
let currentTurn = 0;
let currentHands = [[], []];
let roomId = null;
let selectedCell = null; // {row, col} 選択中のマス
let selectedHandPiece = null; // 持ち駒選択中の駒名
let pendingMove = null; // 成り確認中の移動

function findMatch() {
  document.getElementById('matchStatus').textContent = '⏳ 相手を探しています...';
  document.getElementById('findMatchBtn').disabled = true;
  socket.emit('findMatch');
}

socket.on('waiting', () => {
  document.getElementById('matchStatus').textContent = '⏳ 相手を待っています...';
});

socket.on('matchFound', (data) => {
  roomId = data.roomId;
  myColor = data.color;
  myPlayerIndex = myColor === 'sente' ? 0 : 1;
  currentBoard = data.board;
  currentTurn = data.turn;
  currentHands = data.hands;

  document.getElementById('matchScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  document.getElementById('myColor').textContent =
    `あなたは${myColor === 'sente' ? '先手（下）' : '後手（上）'}`;

  renderBoard();
  renderHands();
  updateTurnInfo();
});

socket.on('boardUpdate', (data) => {
  currentBoard = data.board;
  currentTurn = data.turn;
  currentHands = data.hands;
  selectedCell = null;
  selectedHandPiece = null;
  renderBoard(data.lastMove);
  renderHands();
  updateTurnInfo();
});

socket.on('gameOver', (data) => {
  const winner = data.winner === myPlayerIndex ? 'あなたの勝ち！🎉' : '相手の勝ち...';
  setTimeout(() => alert(`ゲーム終了: ${winner}`), 200);
});

socket.on('opponentLeft', () => {
  alert('相手が切断しました。');
  location.reload();
});

// ========== 盤面描画 ==========

function renderBoard(lastMove = null) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  // 後手視点は180度回転
  const displayBoard = myColor === 'gote' ? reverseBoard(currentBoard) : currentBoard;
  const movableCells = getMovableCells();

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const actualRow = myColor === 'gote' ? 8 - r : r;
      const actualCol = myColor === 'gote' ? 8 - c : c;
      const piece = displayBoard[r][c];

      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = actualRow;
      cell.dataset.col = actualCol;

      // ハイライト
      if (selectedCell && selectedCell.row === actualRow && selectedCell.col === actualCol)
        cell.classList.add('selected');
      if (movableCells.some(m => m.row === actualRow && m.col === actualCol))
        cell.classList.add('movable');
      if (lastMove) {
        if ((lastMove.from && lastMove.from.row === actualRow && lastMove.from.col === actualCol) ||
            (lastMove.to && lastMove.to.row === actualRow && lastMove.to.col === actualCol))
          cell.classList.add('last-move');
      }

      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${piece.player === 0 ? 'sente' : 'gote'}`;
        if (piece.promoted) pieceEl.classList.add('promoted');
        const name = piece.promoted ? getPromotedName(piece.type) : PIECE_NAMES[piece.type];
        pieceEl.textContent = name || piece.type;
        cell.appendChild(pieceEl);
      }

      cell.addEventListener('click', () => onCellClick(actualRow, actualCol));
      boardEl.appendChild(cell);
    }
  }
}

function reverseBoard(board) {
  return board.slice().reverse().map(row => row.slice().reverse());
}

function getPromotedName(type) {
  const map = {
    rook: '龍', bishop: '馬', silver: '全',
    knight: '圭', lance: '杏', pawn: 'と'
  };
  return map[type] || PIECE_NAMES[type];
}

// ========== セルクリック処理 ==========

function onCellClick(row, col) {
  const isMyTurn = currentTurn === myPlayerIndex;
  const piece = currentBoard[row][col];

  // 持ち駒を打つ
  if (selectedHandPiece) {
    if (!piece) {
      socket.emit('drop', { roomId, piece: selectedHandPiece, to: { row, col } });
    }
    selectedHandPiece = null;
    renderBoard();
    renderHands();
    return;
  }

  // 移動先を選択
  if (selectedCell) {
    const movable = getMovableCells();
    if (movable.some(m => m.row === row && m.col === col)) {
      // 成り判定
      const moving = currentBoard[selectedCell.row][selectedCell.col];
      if (canPromote(moving, selectedCell, { row, col })) {
        pendingMove = { from: selectedCell, to: { row, col } };
        document.getElementById('promoteDialog').style.display = 'flex';
        return;
      }
      socket.emit('move', {
        roomId,
        from: selectedCell,
        to: { row, col },
        piece: moving,
        promote: false
      });
      selectedCell = null;
    } else if (piece && piece.player === myPlayerIndex && isMyTurn) {
      selectedCell = { row, col };
    } else {
      selectedCell = null;
    }
    renderBoard();
    return;
  }

  // 自分の駒を選択
  if (piece && piece.player === myPlayerIndex && isMyTurn) {
    selectedCell = { row, col };
    renderBoard();
  }
}

function confirmPromote(doPromote) {
  document.getElementById('promoteDialog').style.display = 'none';
  if (!pendingMove) return;
  const moving = currentBoard[pendingMove.from.row][pendingMove.from.col];
  socket.emit('move', {
    roomId,
    from: pendingMove.from,
    to: pendingMove.to,
    piece: moving,
    promote: doPromote
  });
  selectedCell = null;
  pendingMove = null;
}

// ========== 移動可能マスの計算（簡易版） ==========

function getMovableCells() {
  if (!selectedCell || currentTurn !== myPlayerIndex) return [];
  const piece = currentBoard[selectedCell.row][selectedCell.col];
  if (!piece || piece.player !== myPlayerIndex) return [];
  return calcMoves(currentBoard, selectedCell.row, selectedCell.col, piece);
}

function calcMoves(board, row, col, piece) {
  const moves = [];
  const p = piece.player; // 0=先手, 1=後手
  const dir = p === 0 ? -1 : 1; // 先手は上(row減少)、後手は下(row増加)

  function addMove(r, c) {
    if (r < 0 || r > 8 || c < 0 || c > 8) return false;
    const target = board[r][c];
    if (target && target.player === p) return false;
    moves.push({ row: r, col: c });
    return !target; // 空なら続けられる
  }

  function slide(dr, dc) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r <= 8 && c >= 0 && c <= 8) {
      if (!addMove(r, c)) break;
      r += dr; c += dc;
    }
  }

  const type = piece.promoted ? getPromotedType(piece.type) : piece.type;

  switch (type) {
    case 'king':
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc) addMove(row + dr, col + dc);
      break;

    case 'rook':
      slide(1,0); slide(-1,0); slide(0,1); slide(0,-1);
      break;

    case 'bishop':
      slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1);
      break;

    case 'dragon': // 龍（成り飛車）
      slide(1,0); slide(-1,0); slide(0,1); slide(0,-1);
      addMove(row+1,col+1); addMove(row+1,col-1);
      addMove(row-1,col+1); addMove(row-1,col-1);
      break;

    case 'horse': // 馬（成り角）
      slide(1,1); slide(1,-1); slide(-1,1); slide(-1,-1);
      addMove(row+1,col); addMove(row-1,col);
      addMove(row,col+1); addMove(row,col-1);
      break;

    case 'gold':
    case 'promoted_silver': case 'promoted_knight':
    case 'promoted_lance': case 'promoted_pawn':
      addMove(row+dir,col); addMove(row+dir,col+1); addMove(row+dir,col-1);
      addMove(row,col+1); addMove(row,col-1); addMove(row-dir,col);
      break;

    case 'silver':
      addMove(row+dir,col); addMove(row+dir,col+1); addMove(row+dir,col-1);
      addMove(row-dir,col+1); addMove(row-dir,col-1);
      break;

    case 'knight':
      addMove(row+dir*2, col+1); addMove(row+dir*2, col-1);
      break;

    case 'lance':
      slide(dir, 0);
      break;

    case 'pawn':
      addMove(row+dir, col);
      break;
  }

  return moves;
}

function getPromotedType(type) {
  const map = {
    rook: 'dragon', bishop: 'horse',
    silver: 'promoted_silver', knight: 'promoted_knight',
    lance: 'promoted_lance', pawn: 'promoted_pawn'
  };
  return map[type] || type;
}

function canPromote(piece, from, to) {
  if (!['pawn','lance','knight','silver','rook','bishop'].includes(piece.type)) return false;
  if (piece.promoted) return false;
  const zone = piece.player === 0 ? to.row <= 2 || from.row <= 2 : to.row >= 6 || from.row >= 6;
  return zone;
}

// ========== 持ち駒表示 ==========

function renderHands() {
  renderHandArea('senteHandPieces', currentHands[0], 0);
  renderHandArea('goteHandPieces', currentHands[1], 1);
}

function renderHandArea(elId, hand, playerIndex) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (hand.length === 0) {
    el.textContent = 'なし';
    return;
  }

  // 同じ駒をまとめる
  const counts = {};
  hand.forEach(p => counts[p] = (counts[p] || 0) + 1);

  Object.entries(counts).forEach(([type, count]) => {
    const btn = document.createElement('span');
    btn.className = 'hand-piece';
    btn.textContent = PIECE_NAMES[type] + (count > 1 ? `×${count}` : '');
    if (playerIndex === myPlayerIndex && currentTurn === myPlayerIndex) {
      btn.addEventListener('click', () => {
        selectedHandPiece = type;
        selectedCell = null;
        renderBoard();
        // ハイライト
        document.querySelectorAll('.hand-piece').forEach(b => b.classList.remove('selected-drop'));
        btn.classList.add('selected-drop');
      });
    }
    el.appendChild(btn);
  });
}

function updateTurnInfo() {
  const isMyTurn = currentTurn === myPlayerIndex;
  document.getElementById('turnInfo').textContent =
    isMyTurn ? '🔴 あなたの番' : '⌛ 相手の番';
}