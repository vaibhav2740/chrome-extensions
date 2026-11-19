// Fair play: Pawnshot is for learning, never for help in a game that is still being played.
// On chess.com, chesskid.com and lichess the panel locks itself while a game (or a rated puzzle) is in progress on the
// tab, the same rule those sites apply to their own analysis. Every way of reading the board goes through this check
// (the page's board data, a video frame, a screenshot), so a live game can't be read by "taking a picture" instead.
//
// It fails closed: on a page where people play, Pawnshot stays locked unless the page clearly shows the game is over.
// Injected before content.js (classic script, same isolated world). check(location, document) is pure, for the tests.
(() => {
  const any = (doc, sels) => sels.some((s) => { try { return !!doc.querySelector(s); } catch (e) { return false; } });

  // ---- chess.com / chesskid.com ----
  // Pages where you play or solve rated puzzles. `/analysis/game/live/123` (reviewing a game) starts with /analysis
  // and is not matched; `/games/archive` is not `/game/`.
  const CC_PLAY = /^\/(play|game|live|daily|puzzles?|variants|4-player-chess|solo-chess)(\/|$)/i;
  // Signs that the game on screen is over (end-of-game dialog, result in the move list, review buttons).
  const CC_OVER = [
    '.game-over-modal-content', '.game-over-modal-container', '.game-over-header-component', '[data-cy="game-over-modal"]',
    '.game-result-component', '.game-result', '.game-over-buttons-component', '.game-over-review-button-component',
    '[data-cy="game-review-button"]', '.game-review-buttons-component',
  ];
  // Signs that a clock is still running or the player still has resign / draw / abort buttons.
  const CC_RUNNING = [
    '.clock-component.clock-running', '.clock-component.clock-player-turn', '.clock-running', '.clock-player-turn',
    '[data-cy="resign-button"]', '.resign-button-component', '[data-cy="abort-button"]', '.abort-button-component',
    '[data-cy="draw-button"]', '.draw-button-component',
  ];
  const PUZZLE = /^\/(puzzles?|solo-chess)(\/|$)/i;

  function chesscom(path, doc) {
    if (!CC_PLAY.test(path)) return null;
    if (PUZZLE.test(path)) return 'puzzle';
    if (any(doc, CC_RUNNING)) return 'game';
    if (any(doc, CC_OVER)) return null;
    return 'game'; // a play page that does not say the game is over: assume it is not
  }

  // ---- lichess (and lichess-based sites, which share its page structure) ----
  const LI_GAME_VIEW = ['main.round', '.round__app'];
  const LI_RUNNING = ['.rclock.running', '.rcontrols .ricons', '.rcontrols .resign', '.rcontrols .abort'];
  const LI_OVER = ['.result-wrap', '.rcontrols .follow-up', '.follow-up'];
  const LI_PUZZLE_PATH = /^\/(training|streak|storm|racer)(\/|$)/i;

  function lichess(path, doc) {
    if (LI_PUZZLE_PATH.test(path) || any(doc, ['main.puzzle', 'main.storm', 'main.racer'])) return 'puzzle';
    if (!any(doc, LI_GAME_VIEW)) return null; // analysis board, studies, broadcasts, editor...
    if (any(doc, LI_RUNNING)) return 'game';
    if (any(doc, LI_OVER)) return null;
    return 'game';
  }

  const REASON = {
    game: 'A game is being played on this tab, so Pawnshot is off until it ends. Chess.com and lichess do the same with their own analysis. Review the game afterwards.',
    puzzle: 'Rated puzzles are yours to solve, so Pawnshot is off on this page. Open the puzzle position on an analysis board afterwards.',
  };

  function check(loc, doc) {
    const host = String((loc && loc.hostname) || '').toLowerCase();
    const path = String((loc && loc.pathname) || '/');
    let site = null, kind = null;
    if (/(^|\.)chess\.com$/.test(host)) { site = 'chesscom'; kind = chesscom(path, doc); }
    else if (/(^|\.)chesskid\.com$/.test(host)) { site = 'chesskid'; kind = chesscom(path, doc); }
    else if (/(^|\.)lichess\.org$/.test(host)) { site = 'lichess'; kind = lichess(path, doc); }
    else if (any(doc, LI_GAME_VIEW) && any(doc, ['cg-board'])) { site = 'lichess-like'; kind = lichess(path, doc); }
    return { site, locked: !!kind, kind, reason: kind ? REASON[kind] : '' };
  }

  globalThis.__pawnshotFairPlay = { check };
})();
