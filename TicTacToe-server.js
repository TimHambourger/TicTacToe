var finalHandler = require('finalhandler'), 
    http = require('http'),
    serveStatic = require('serve-static'),
    ws = require('ws'),
    path = require('path'),
    programArgs = require('commander'),
    pjson = require('./package.json');

programArgs
    .version(pjson.version)
    .description('Start a TicTacToe web socket server')
    .option('-p, --port <port>', 'listen at this port. Default is 8080.', 8080)
    .option('-o, --origins <origins>', 'a comma separated list of fully-qualified allowed origins. Defaults to \'http://localhost:<port>\'.', function (val) { return val.split(','); }, [])
    .parse(process.argv);

if (programArgs.origins.length === 0)
    programArgs.origins.push('http://localhost:' + programArgs.port);

var gameId = 0,
    waitingClient = null;



/**
 * TIC TAC TOE BOARD - POSITION INDICES
 *
 *          |         |
 *     0    |    1    |    2
 *          |         |
 * _________|_________|_________
 *          |         |
 *     3    |    4    |    5
 *          |         |
 * _________|_________|_________
 *          |         |
 *     6    |    7    |    8
 *          |         |
 */


/**
 * TIC TAC TOE BOARD - POSITION VALUES
 *
 *          |         |
 *     1    |    2    |    4
 *          |         |
 * _________|_________|_________
 *          |         |
 *     8    |    16   |    32
 *          |         |
 * _________|_________|_________
 *          |         |
 *     64   |    128  |    256
 *          |         |
 */

var TicTacToePositionValues = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x100],
    TicTacToeWinningCombinations = [0x01|0x02|0x04, 0x08|0x10|0x20, 0x40|0x80|0x100,
                                    0x01|0x08|0x40, 0x02|0x10|0x80, 0x04|0x20|0x100,
                                    0x01|0x10|0x100, 0x04|0x10|0x40],
    TicTacToeFull = 0x1FF,     
    TicTacToeRole = { x: 'x', o: 'o' },
    GameEvent = {
        start: 'game-start',
        move: 'move',
        complete: 'game-complete',
        abruptEnd: 'game-abrupt-end'
    };

var serveStaticFile = serveStatic(path.join(__dirname, 'public'));

var httpServer = http.createServer(function (req, res) {
    serveStaticFile(req, res, function (err) {
        if (req.url === '/gameConstants') {
            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                TicTacToeRole: TicTacToeRole,
                GameEvent: GameEvent
            }));
        } else {
            finalHandler(req, res)(err);
        }
    });
}).listen(programArgs.port);

console.log('TicTacToe server listening on port ' + programArgs.port + '...');

var wsServer = new ws.Server({
    server: httpServer,
    path: '/TicTacToe/connect',
    verifyClient: function (info) {
        if (programArgs.origins.indexOf(info.origin) >= 0) return true;
        return false;
    }
});

wsServer.on('connection', function (socket) {
    var client = new ClientConnection(socket);
    if (waitingClient === null) waitingClient = client;
    else {
        var game = new TicTacToeGame(waitingClient, client);
        console.log('Starting game ' + game.id);
        waitingClient = null;
    }

    socket.on('message', function (msg, flags) {
        if (flags.binary) socket.close(1003, 'Message must be text only');
        var msgObj;
        try {
            msgObj = JSON.parse(msg);
        } catch (ex) {
            socket.close(1003, 'Message must be formatted as JSON');
        }
        if (msgObj.move === undefined)
            socket.close(1008, 'Message must have a move property');
        if (client.game === null)
            socket.close(1008, 'You can\'t move because you\'re not in a game');
        client.game.doTryMove(client.role, msgObj.move);
    });

    socket.on('close', handleInterrupt);
    socket.on('error', handleInterrupt);

    function handleInterrupt() {
        if (client.game !== null)
            client.game.processDisconnect(client);
        if (waitingClient === client) waitingClient = null;
    }
});
        

function TicTacToeGame(xClient, oClient) {
    this.id = gameId++;
    this.bothPlayers = [xClient, oClient];
    xClient.game = this;
    xClient.role = TicTacToeRole.x;
    oClient.game = this;
    oClient.role = TicTacToeRole.o;
    this.board = {};
    this.board[TicTacToeRole.x] = 0;
    this.board[TicTacToeRole.o] = 0;
    this.nextTurn = TicTacToeRole.x;
    this.isComplete = false;
    xClient.socket.send(JSON.stringify({
        evt: GameEvent.start,
        role: TicTacToeRole.x,
        nextTurn: this.nextTurn
    }));
    oClient.socket.send(JSON.stringify({
        evt: GameEvent.start,
        role: TicTacToeRole.o,
        nextTurn: this.nextTurn
    }));
}

TicTacToeGame.prototype.getWinningLine = function (role) {
   for (var i = 0; i < TicTacToeWinningCombinations.length; i++) {
       var combination = TicTacToeWinningCombinations[i];
       if ((this.board[role] & combination) === combination) return combination;
   }
   return null;
};

TicTacToeGame.prototype.isFull = function () {
    return (this.board[TicTacToeRole.x] | this.board[TicTacToeRole.o])
        === TicTacToeFull;
};

TicTacToeGame.prototype.isValidMove = function (role, move) {
    return this.nextTurn === role
        && [0, 1, 2, 3, 4, 5, 6, 7, 8].indexOf(move) >= 0
        && (this.board[TicTacToeRole.x] & TicTacToePositionValues[move]) === 0
        && (this.board[TicTacToeRole.o] & TicTacToePositionValues[move]) === 0;
};

TicTacToeGame.prototype.executeMove = function (role, move) {
    this.board[role] |= TicTacToePositionValues[move];
    var newNextTurn = this.nextTurn === TicTacToeRole.x ? TicTacToeRole.o : TicTacToeRole.x;
    this.nextTurn = newNextTurn;
    this.bothPlayers.forEach(function (client) {
        client.socket.send(JSON.stringify({
            evt: GameEvent.move,
            role: role,
            move: move,
            nextTurn: newNextTurn
        }));
    });
};

TicTacToeGame.prototype.doTryMove = function (role, move) {
    if (!this.isValidMove(role, move)) return;
    this.executeMove(role, move);
    var winningLine = this.getWinningLine(role);
    if (winningLine !== null) this.markAsComplete(role, winningLine);
    else if (this.isFull()) this.markAsComplete(null, null);
};

TicTacToeGame.prototype.markAsComplete = function (winner, winningLine) {
    this.isComplete = true;
    this.bothPlayers.forEach(function (client) {
        client.socket.close(1000, JSON.stringify({
            evt: GameEvent.complete,
            winner: winner,
            winningLine: winningLine
        }));
    });
    console.log('Game ' + this.id + ' completed normally');
};

TicTacToeGame.prototype.otherPlayer = function (client) {
    for (var i = 0; i < this.bothPlayers.length; i++) {
        if (this.bothPlayers[i] !== client) return this.bothPlayers[i];
    }
};

TicTacToeGame.prototype.processDisconnect = function (client) {
    if (!this.isComplete) {
        this.isComplete = true;
        this.otherPlayer(client).socket.close(1011,
            JSON.stringify({ evt: GameEvent.abruptEnd }));
        console.log('Game ' + this.id + ' ended abruptly');
    }
};

function ClientConnection(socket) {
    this.socket = socket;
    this.role = null;
    this.game = null;
}

