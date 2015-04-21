var loc = window.location.host + window.location.pathname.substr(1),
    wsUri = 'ws://' + loc + '/TicTacToe/connect',
    Constants = {},
    currentGame = ko.observable(),
    vm = {
        CurrentGame: currentGame,
        StartNewGame: StartNewGame
    };

ko.applyBindings(vm);

$.ajax({
    url: 'gameConstants',
    method: 'GET'
})
.done(function (data) {
    Extend(Constants, data);
    StartNewGame();
});
    
function StartNewGame() {
    currentGame(new Game());
}

function Game() {
    var GameStatus = {
        WaitingForGame: 0,
        Started: 1,
        Complete: 2,
        AbruptEnd: 3,
        Current: ko.observable()
    };
    GameStatus.Current(GameStatus.WaitingForGame);

    var Move = {
        NA: 0,
        Mine: 1,
        Theirs: 2,
        Current: ko.observable()
    };
    Move.Current(Move.NA);

    var Winner = {
        NA: 0,
        Me: 1,
        Them: 2,
        Draw: 3,
        Actual: ko.observable()
    };
    Winner.Actual(Winner.NA);

    var board = [ko.observable(''), ko.observable(''), ko.observable(''),
                 ko.observable(''), ko.observable(''), ko.observable(''),
                 ko.observable(''), ko.observable(''), ko.observable('')], 
        role = ko.observable(),
        displayRole = ko.pureComputed(function () {
            return DisplayRole(role());
        }),
        hasError = ko.observable(false),
        winningLine = ko.observable(),
        socket;

    try { socket = new WebSocket(wsUri); }
    catch (ex) { hasError(true); }

    if (socket) {
        socket.onmessage = function (e) {
            var msg = JSON.parse(e.data);
            if (msg.evt === Constants.GameEvent.start) {
                GameStatus.Current(GameStatus.Started);
                role(msg.role);
                UpdateTurn(msg.nextTurn);
            }
            if (msg.evt === Constants.GameEvent.move) {
                board[msg.move](DisplayRole(msg.role));
                UpdateTurn(msg.nextTurn);
            }
        };

        socket.onclose = function (e) {
            var msg;
            try {
                msg = JSON.parse(e.reason);
            } catch (ex) {
                hasError(true);
                return;
            }
            if (msg.evt === Constants.GameEvent.complete) {
                GameStatus.Current(GameStatus.Complete);
                var winner;
                if (role() === msg.winner) {
                    winner = Winner.Me;
                } else {
                    var otherRole = role() === Constants.TicTacToeRole.x
                        ? Constants.TicTacToeRole.o : Constants.TicTacToeRole.x;
                    if (otherRole === msg.winner) winner = Winner.Them;
                    else winner = Winner.Draw;
                }
                Winner.Actual(winner);
                winningLine(msg.winningLine);
            }
            if (msg.evt === Constants.GameEvent.abruptEnd) {
                GameStatus.Current(GameStatus.AbruptEnd);
            }
        };

        socket.onerror = function () {
            hasError(true);
        };
    }

    return {
        GameStatus: GameStatus,
        Move: Move,
        Winner: Winner,
        Board: board,
        Role: displayRole,
        MoveTo: MoveTo,
        WinningLine: WinningLine,
        HasError: hasError
    };
 
    function DisplayRole(role) {
        return role === Constants.TicTacToeRole.x ? 'X' : 'O';
    }

    function UpdateTurn(nextTurn) {
        Move.Current(role() === nextTurn ? Move.Mine : Move.Theirs);
    }

    function MoveTo(move) {
        return function () {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify({
                move: move
            }));
        };
    }

    function WinningLine(posArray) {
        var value = 0;
        for (var i = 0; i < posArray.length; i++) {
            value |= 1 << posArray[i];
        }
        return ko.pureComputed(function () {
            return winningLine() === value;
        });
    }
}

function Extend(obj1, obj2) {
    for (var key in obj2) obj1[key] = obj2[key];
    return obj1;
}

