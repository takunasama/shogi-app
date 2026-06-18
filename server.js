const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 待機中のプレイヤーと部屋の管理
let waitingPlayer = null;
const rooms = {};

io.on('connection', (socket) => {
  console.log('接続:', socket.id);

  // マッチング
  socket.on('findMatch', () => {
    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      // マッチ成立
      const roomId = `room_${Date.now()}`;
      rooms[roomId] = {
        players: [waitingPlayer.id, socket.id],
        board: initBoard(),
        turn: 0, // 0=先手(waitingPlayer), 1=後手(socket)
        hands: [[], []] // 持ち駒
      };

      waitingPlayer.join(roomId);
      socket.join(roomId);

      io.to(waitingPlayer.id).emit('matchFound', {
        roomId, color: 'sente', board: rooms[roomId].board,
        turn: 0, hands: rooms[roomId].hands
      });
      io.to(socket.id).emit('matchFound', {
        roomId, color: 'gote', board: rooms[roomId].board,
        turn: 0, hands: rooms[roomId].hands
      });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('waiting');
    }
  });

  // 駒を動かす
  socket.on('move', ({ roomId, from, to, piece, promote }) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex !== room.turn) return; // 手番でない

    const moved = applyMove(room, from, to, piece, promote, playerIndex);
    if (!moved) return;

    room.turn = room.turn === 0 ? 1 : 0;

    io.to(roomId).emit('boardUpdate', {
      board: room.board, turn: room.turn, hands: room.hands,
      lastMove: { from, to }
    });

    // 詰み判定（簡易）
    if (isKingCaptured(room.board)) {
      io.to(roomId).emit('gameOver', { winner: playerIndex });
    }
  });

  // 駒を打つ
  socket.on('drop', ({ roomId, piece, to }) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex !== room.turn) return;

    const dropped = applyDrop(room, piece, to, playerIndex);
    if (!dropped) return;

    room.turn = room.turn === 0 ? 1 : 0;

    io.to(roomId).emit('boardUpdate', {
      board: room.board, turn: room.turn, hands: room.hands,
      lastMove: { from: null, to }
    });
  });

  // 切断処理
  socket.on('disconnect', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    // 対戦中の場合、相手に通知
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        const opponentId = room.players.find(id => id !== socket.id);
        if (opponentId) io.to(opponentId).emit('opponentLeft');
        delete rooms[roomId];
      }
    }
  });
});

// ========== 将棋ロジック ==========

function initBoard() {
  // 9x9の盤面 null=空, {type:駒名, player:0or1, promoted:bool}
  const board = Array(9).fill(null).map(() => Array(9).fill(null));

  // 後手（上側）初期配置
  const goteBack = ['lance','knight','silver','gold','king','gold','silver','knight','lance'];
  goteBack.forEach((type, col) => {
    board[0][col] = { type, player: 1, promoted: false };
  });
  board[1][1] = { type: 'bishop', player: 1, promoted: false };
  board[1][7] = { type: 'rook', player: 1, promoted: false };
  for (let col = 0; col < 9; col++) {
    board[2][col] = { type: 'pawn', player: 1, promoted: false };
  }

  // 先手（下側）初期配置
  const senteBack = ['lance','knight','silver','gold','king','gold','silver','knight','lance'];
  senteBack.forEach((type, col) => {
    board[8][col] = { type, player: 0, promoted: false };
  });
  board[7][7] = { type: 'bishop', player: 0, promoted: false };
  board[7][1] = { type: 'rook', player: 0, promoted: false };
  for (let col = 0; col < 9; col++) {
    board[6][col] = { type: 'pawn', player: 0, promoted: false };
  }

  return board;
}

function applyMove(room, from, to, piece, promote, playerIndex) {
  const { board, hands } = room;
  const target = board[to.row][to.col];

  // 相手の駒を取る
  if (target) {
    if (target.player === playerIndex) return false; // 自分の駒は取れない
    const captured = demote(target.type);
    hands[playerIndex].push(captured);
  }

  // 駒を移動
  const movingPiece = { ...board[from.row][from.col] };
  if (promote) movingPiece.promoted = true;
  board[to.row][to.col] = movingPiece;
  board[from.row][from.col] = null;
  return true;
}

function applyDrop(room, pieceType, to, playerIndex) {
  const { board, hands } = room;
  if (board[to.row][to.col]) return false;

  const idx = hands[playerIndex].indexOf(pieceType);
  if (idx === -1) return false;

  hands[playerIndex].splice(idx, 1);
  board[to.row][to.col] = { type: pieceType, player: playerIndex, promoted: false };
  return true;
}

function demote(type) {
  const map = {
    'promoted_pawn': 'pawn', 'promoted_lance': 'lance',
    'promoted_knight': 'knight', 'promoted_silver': 'silver',
    'dragon': 'rook', 'horse': 'bishop'
  };
  return map[type] || type;
}

function isKingCaptured(board) {
  let kings = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c]?.type === 'king') kings++;
  return kings < 2;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`サーバー起動: http://localhost:${PORT}`));