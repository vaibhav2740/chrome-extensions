// Following a video quickly: the square-by-square move finder (video-track.js) and the search for moves that were
// played between two reads (findLine in notation.js). Offline: video frames are built from the piece sets in
// test/fixtures (real pictures of boards), with highlights, arrows, a cursor, blur and noise added.
import { Chess } from "../lib/chess.js";
import { REGION, alignBoard, fastMove } from "../video-track.js";
import { findLine } from "../notation.js";
import { TRUE_BOX, frame, guessBox, loadSet, rand } from "./synth.mjs";

let fail = 0;
const check = (n, c, x = "") => { console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); if (!c) fail++; };

const fm = (args) => fastMove({ box: TRUE_BOX, ...args });

// ---------- 1. a whole game, move by move ----------
// Morphy's Opera game (captures, checks, queenside castling, mate) and a Ruy Lopez (both sides castle short)
const GAME = "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(" ");
const RUY = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7".split(" ");

// Play the game against one look; count right, wrong (the worst outcome) and "ask the reader".
function playGame(set, opts = {}) {
  const a = playOne(set, opts, GAME), b = playOne(set, opts, RUY);
  return { right: a.right + b.right, wrong: a.wrong + b.wrong, unsure: a.unsure + b.unsure, why: { ...a.why, ...b.why }, n: a.n + b.n };
}
function playOne(set, opts, moves) {
  const g = new Chess();
  let last = null, right = 0, wrong = 0, unsure = 0, seed = 11;
  const why = {};
  let prevFrame = frame(set, g.fen().split(" ")[0], { ...opts, seed: seed++ });
  // as in the panel: the board finder's box, made exact once against a position that is known
  const box = alignBoard(prevFrame, REGION, g.fen().split(" ")[0], !!opts.black, guessBox(opts));
  for (const san of moves) {
    const fen = g.fen();
    const m = g.move(san);
    const now = frame(set, g.fen().split(" ")[0], { ...opts, highlight: [m.from, m.to], seed: seed++ });
    const r = fastMove({ ref: prevFrame, now, fen, box, black: !!opts.black, lastMove: last });
    if (r.moves && r.moves.length === 1 && r.moves[0].san === m.san) right++;
    else if (r.moves || r.none) { wrong++; why[san] = r.moves ? r.moves.map((x) => x.san).join(" ") : "none"; }
    else { unsure++; why[san] = r.unsure; }
    last = { from: m.from, to: m.to };
    prevFrame = now;
  }
  return { right, wrong, unsure, why, n: moves.length };
}

const sets = {
  cburnett: loadSet("P1_start__A_cburnett_brown.png"),
  merida: loadSet("P2_italian__B_merida_green.png"),
  alpha: loadSet("P3_najdorf__C_alpha_blue.png"),
  greenFlat: loadSet("P1_start__A_cburnett_brown.png", [[238, 238, 210], [118, 150, 86]]),
};

console.log("1. two games (53 moves: captures, checks, castling both ways, mate) followed square by square");
for (const [name, set] of Object.entries(sets)) {
  const r = playGame(set);
  check(`${name}: every move found, none wrong (${r.right}/${r.n}, asked the reader ${r.unsure}×)`, r.wrong === 0 && r.right >= r.n - 1, JSON.stringify(r.why));
}
{
  const r = playGame(sets.cburnett, { black: true });
  check(`Black at the bottom of the picture works the same (${r.right}/${r.n})`, r.wrong === 0 && r.right >= r.n - 1, JSON.stringify(r.why));
}
for (const [name, set] of [["cburnett", sets.cburnett], ["merida", sets.merida]]) {
  const r = playGame(set, { blur: true, noise: 6 });
  check(`${name} as a blurry, noisy video: never wrong, most moves still instant (${r.right}/${r.n})`, r.wrong === 0 && r.right >= r.n * 0.85, JSON.stringify(r.why));
}

console.log("1b. harder pictures: the board box a little off, strong highlights, heavy noise, random games");
for (const [label, o] of [
  ["board finder 30% of a square off to the side", { shift: [0.3, -0.2] }],
  ["board finder 5% too big", { zoom: 1.05 }],
  ["strong highlights", { hlAlpha: 0.7 }],
  ["heavy noise and blur", { noise: 10, blur: true }],
]) {
  let wrong = 0, right = 0, n = 0;
  for (const set of Object.values(sets)) { const r = playGame(set, o); wrong += r.wrong; right += r.right; n += r.n; }
  check(`${label}: never a wrong move (${right}/${n} instant)`, wrong === 0 && right >= n * 0.7, `${wrong} wrong`);
}
{
  // random legal games (no promotions) on every set, including the wood-textured staunty board of the rook ending
  const staunty = loadSet("P4_rookend__E_staunty_brown.png");
  const all = { ...sets, staunty };
  let wrong = 0, right = 0, n = 0;
  const wrongs = [];
  for (const [name, set] of Object.entries(all)) {
    for (let game = 0; game < 3; game++) {
      const rnd = rand(1000 + game * 31 + name.length);
      const g = new Chess(name === "staunty" ? "8/5pk1/6p1/3R4/8/6P1/5PK1/3r4 w - - 0 1" : undefined);
      let prev = frame(set, g.fen().split(" ")[0], { seed: game }), last = null;
      for (let ply = 0; ply < 40 && !g.isGameOver(); ply++) {
        const legal = g.moves({ verbose: true }).filter((m) => !m.promotion && Object.keys(set.sprites).includes(m.color === "w" ? m.piece.toUpperCase() : m.piece));
        if (!legal.length) break;
        const fen = g.fen();
        const m = g.move(legal[Math.floor(rnd() * legal.length)]);
        const now = frame(set, g.fen().split(" ")[0], { highlight: [m.from, m.to], seed: ply * 7 + game, noise: 5 });
        const r = fm({ ref: prev, now, fen, lastMove: last });
        n++;
        if (r.moves && r.moves.length === 1 && r.moves[0].san === m.san) right++;
        else if (r.moves || r.none) { wrong++; wrongs.push(`${name}:${m.san}->${r.moves ? r.moves[0].san : "none"}`); }
        prev = now; last = { from: m.from, to: m.to };
      }
    }
  }
  check(`random games on five piece sets: never a wrong move (${right}/${n} instant)`, wrong === 0 && right >= n * 0.9, wrongs.join(", "));
}

console.log("1c. lining the grid up with the board when the board finder is a little off");
{
  const g = new Chess(); for (const s2 of GAME.slice(0, 12)) g.move(s2);
  const pl = g.fen().split(" ")[0];
  let worst = 0;
  for (const [name, set] of Object.entries(sets)) {
    const px = frame(set, pl, { seed: 9, noise: 5 });
    for (const o of [{ shift: [0.3, -0.25] }, { shift: [-0.3, 0.3] }, { zoom: 1.05 }, { zoom: 0.95, shift: [0.2, 0.1] }]) {
      const b = alignBoard(px, REGION, pl, false, guessBox(o));
      worst = Math.max(worst, Math.abs(b.x - TRUE_BOX.x), Math.abs(b.y - TRUE_BOX.y), Math.abs(b.w - TRUE_BOX.w));
    }
  }
  check(`a box up to a third of a square off is pulled onto the board (worst error ${worst.toFixed(1)} px of ${(TRUE_BOX.w / 8).toFixed(1)} per square)`, worst <= 2);
  const t = performance.now();
  alignBoard(frame(sets.cburnett, pl), REGION, pl, false, guessBox({ shift: [0.3, 0.3] }));
  check(`and that takes a moment only (${(performance.now() - t).toFixed(0)} ms, done once per reader result)`, performance.now() - t < 120);
}

console.log("2. special moves");
{
  const g = new Chess();
  for (const s of ["e4", "Nf6", "e5", "d5"]) g.move(s);
  const fen = g.fen(), ref = frame(sets.cburnett, fen.split(" ")[0], { highlight: ["d7", "d5"] });
  const m = g.move("exd6");
  const r = fm({ ref, now: frame(sets.cburnett, g.fen().split(" ")[0], { highlight: [m.from, m.to] }), fen, lastMove: { from: "d7", to: "d5" } });
  check("en passant (three squares change) is found", r.moves && r.moves[0].san === "exd6", JSON.stringify(r));
}
{
  const fen = "8/P5k1/8/8/8/8/6K1/8 w - - 0 1";
  const g = new Chess(fen); g.move("a8=Q");
  const r = fm({ ref: frame(sets.cburnett, fen.split(" ")[0]), now: frame(sets.cburnett, g.fen().split(" ")[0]), fen });
  check("a promotion is left to the reader (which piece it became needs a real look)", !!r.unsure && !r.moves, JSON.stringify(r));
}

console.log("3. two moves between looks (a quick exchange)");
{
  const g = new Chess();
  let right = 0, wrong = 0, n = 0;
  for (let i = 0; i + 1 < 30; i += 2) {
    const fen = g.fen(), ref = frame(sets.cburnett, fen.split(" ")[0], { seed: i });
    const a = g.move(GAME[i]), b = g.move(GAME[i + 1]);
    const r = fm({ ref, now: frame(sets.cburnett, g.fen().split(" ")[0], { highlight: [b.from, b.to], seed: i + 100 }), fen });
    n++;
    if (r.moves && r.moves.map((x) => x.san).join(" ") === `${a.san} ${b.san}`) right++;
    else if (r.moves || r.none) wrong++;
  }
  check(`both moves are found from one look (${right}/${n}), never a wrong pair`, wrong === 0 && right >= n - 2, `${wrong} wrong`);
}

console.log("4. things that are not moves");
{
  const g = new Chess();
  for (const s of GAME.slice(0, 10)) g.move(s);
  const fen = g.fen(), pl = fen.split(" ")[0];
  const ref = frame(sets.cburnett, pl, { highlight: ["e1", "g1"] });
  const arrowOnly = fm({ ref, now: frame(sets.cburnett, pl, { highlight: ["e1", "g1"], arrows: [["d2", "d4"]], seed: 3 }), fen, lastMove: { from: "e1", to: "g1" } });
  check("an arrow drawn on the board is not a move", !arrowOnly.moves, JSON.stringify(arrowOnly));
  const longArrow = fm({ ref, now: frame(sets.cburnett, pl, { highlight: ["e1", "g1"], arrows: [["a1", "h8"]], seed: 4 }), fen, lastMove: { from: "e1", to: "g1" } });
  check("a long arrow across the pieces is not a move", !longArrow.moves, JSON.stringify(longArrow));
  const still = fm({ ref, now: frame(sets.cburnett, pl, { highlight: ["e1", "g1"], seed: 5 }), fen, lastMove: { from: "e1", to: "g1" } });
  check("the same position again (video noise only) is 'nothing moved'", still.none === true, JSON.stringify(still));
  const hlGone = fm({ ref, now: frame(sets.cburnett, pl, { seed: 6 }), fen, lastMove: { from: "e1", to: "g1" } });
  check("a highlight going away is 'nothing moved'", hlGone.none === true, JSON.stringify(hlGone));
  const other = new Chess(); for (const s of ["d4", "d5", "c4", "e6", "Nc3", "Nf6"]) other.move(s);
  const cut = fm({ ref, now: frame(sets.cburnett, other.fen().split(" ")[0], { seed: 8 }), fen, lastMove: { from: "e1", to: "g1" } });
  check("a cut to a different game is left to the reader", !!cut.unsure, JSON.stringify(cut));
  let wrongWithArrow = 0, wrongWithCursor = 0, okCursor = 0;
  const h = new Chess();
  let prev = frame(sets.cburnett, h.fen().split(" ")[0], { seed: 1 });
  for (let i = 0; i < 24; i++) {
    const fen2 = h.fen(); const m = h.move(GAME[i]); const pl2 = h.fen().split(" ")[0];
    const withArrow = fm({ ref: prev, now: frame(sets.cburnett, pl2, { highlight: [m.from, m.to], arrows: [["a2", "c4"]], seed: 40 + i }), fen: fen2 });
    if (withArrow.moves && withArrow.moves[0].san !== m.san) wrongWithArrow++;
    const withCursor = fm({ ref: prev, now: frame(sets.cburnett, pl2, { highlight: [m.from, m.to], cursor: m.to, seed: 80 + i }), fen: fen2 });
    if (withCursor.moves && withCursor.moves[0].san !== m.san) wrongWithCursor++;
    if (withCursor.moves && withCursor.moves[0].san === m.san) okCursor++;
    prev = frame(sets.cburnett, pl2, { highlight: [m.from, m.to], seed: 120 + i });
  }
  check("a move made while an arrow is on the board is never read as a different move", wrongWithArrow === 0, `${wrongWithArrow} wrong`);
  check(`the mouse pointer resting on the piece never causes a wrong move (${okCursor}/24 still instant)`, wrongWithCursor === 0, `${wrongWithCursor} wrong`);
}

console.log("5. speed");
{
  const g = new Chess(); for (const s of GAME.slice(0, 20)) g.move(s);
  const fen = g.fen(), ref = frame(sets.cburnett, fen.split(" ")[0]);
  const m = g.move(GAME[20]);
  const now = frame(sets.cburnett, g.fen().split(" ")[0], { highlight: [m.from, m.to] });
  fm({ ref, now, fen });
  const t = performance.now();
  for (let i = 0; i < 20; i++) fm({ ref, now, fen });
  const one = (performance.now() - t) / 20;
  check(`one move is found in a few milliseconds (${one.toFixed(1)} ms; the neural reader takes about 300)`, one < 25);
}

console.log("6. moves played between two reads (findLine)");
{
  const after = (fen, sans) => { const g = new Chess(fen); for (const s of sans) g.move(s); return g.fen(); };
  const start = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
  for (const line of [["Bb5"], ["Bb5", "a6"], ["Bb5", "a6", "Bxc6"], ["d4", "exd4", "Nxd4"], ["Bc4", "Bc5", "O-O"]]) {
    const t = performance.now();
    const r = findLine(start, after(start, line).split(" ")[0]);
    const ms = performance.now() - t;
    check(`${line.length} move${line.length > 1 ? "s" : ""} (${line.join(" ")}) found in ${ms.toFixed(1)} ms`, r && r.moves.map((m) => m.san).join(" ") === line.join(" ") && ms < 150, JSON.stringify(r));
  }
  const r4 = findLine(start, after(start, ["Bc4", "Bc5", "c3", "Nf6"]).split(" ")[0], { maxPly: 4 });
  check("four moves in a row can be found too", r4 && r4.moves.length === 4);
  check("a position more moves away than allowed is not forced into a line", findLine(start, after(start, ["Bc4", "Bc5", "c3", "Nf6"]).split(" ")[0], { maxPly: 3 }) === null);
  const played = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
  const back = findLine(played, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR", { prior: [{ from: "e7", to: "e5" }, { from: "g1", to: "f3" }] });
  check("stepping back a move in the video is not taken as the knight going back", back === null, JSON.stringify(back));
  const wrongTurn = findLine("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR");
  check("a wrongly guessed side to move is fixed for a single move", wrongTurn && wrongTurn.moves[0].san === "e5");
}

if (fail) { console.log(`\n${fail} check(s) failed`); process.exit(1); }
console.log("\nall track checks passed");
