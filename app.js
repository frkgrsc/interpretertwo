// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.get("/", (req,res) =>{
    res.send( "Secure" )
});

// Oda bilgilerini tutan bir nesne
// rooms = { roomName: { users: [{id, username, isAdmin}, ...], password: '...' } }
let rooms = {};

// --- Helper Function to Handle User Leaving ---
// Bu fonksiyon kullanıcı ayrıldığında (disconnect, leaveRoom veya kickUser) ortak işlemleri yapar
function handleUserLeave(socketId, specificRoomName = null, kicked = false, kickerUsername = null) { // Add kicked flag and kickerUsername
    let roomUserLeft = null; // Hangi odadan ayrıldığını takip etmek için
    let leavingUser = null; // Ayrılan kullanıcıyı saklamak için

    // Eğer belirli bir oda adı verilmediyse (disconnect durumu), tüm odaları kontrol et
    const roomKeys = specificRoomName ? [specificRoomName] : Object.keys(rooms);

    for (const roomName of roomKeys) {
        // Odanın hala var olduğundan ve kullanıcı listesi olduğundan emin ol
        if (!rooms[roomName] || !rooms[roomName].users) continue;

        const userIndex = rooms[roomName].users.findIndex(user => user.id === socketId);

        if (userIndex !== -1) {
            leavingUser = rooms[roomName].users[userIndex]; // Store the user before removing
            const wasAdmin = leavingUser.isAdmin; // Ayrılan kullanıcı admin miydi?
            roomUserLeft = roomName; // Hangi odadan ayrıldığını kaydet

            // Determine the leave message based on whether the user was kicked
            let leaveMessage;
            if (kicked && kickerUsername) {
                 leaveMessage = `${leavingUser.username} was kicked by ${kickerUsername}.`;
                 console.log(`${leavingUser.username} (${socketId}) was kicked from ${roomName} by ${kickerUsername}.`);
            } else {
                 leaveMessage = `${leavingUser.username} left the room.`;
                 console.log(`${leavingUser.username} (${socketId}) is leaving ${roomName}.`);
            }


            // Kullanıcıyı odanın kullanıcı listesinden çıkar
            rooms[roomName].users.splice(userIndex, 1);

            // Odadaki diğer kullanıcılara ayrılma bilgisini ve güncel kullanıcı listesini gönder
            io.to(roomName).emit('roomUsers', {
                message: leaveMessage, // Use the determined message
                // Güncel kullanıcı listesini de gönderelim (admin bilgisiyle)
                users: rooms[roomName].users.map(u => ({ username: u.username, isAdmin: u.isAdmin }))
            });

            // --- Admin Transfer Logic ---
            // Eğer ayrılan kullanıcı admin idiyse VE odada hala kullanıcı varsa
            if (wasAdmin && rooms[roomName].users.length > 0) {
                // Kalan ilk kullanıcıyı yeni admin yapalım (basit strateji)
                const newAdmin = rooms[roomName].users[0];
                newAdmin.isAdmin = true; // Yeni admini işaretle
                console.log(`Admin rights transferred to ${newAdmin.username} in room ${roomName}.`);

                // Odadaki herkese yeni admin bilgisini gönderelim
                 const adminChangeMessage = `Because ${leavingUser.username} left (or was kicked), ${newAdmin.username} is the new admin.`;
                io.to(roomName).emit('adminChanged', {
                    newAdminUsername: newAdmin.username,
                    message: adminChangeMessage
                });
                 // Admin değiştiği için kullanıcı listesini tekrar gönderebiliriz
                io.to(roomName).emit('roomUsers', {
                    message: adminChangeMessage, // Send the same message again for context with the user list
                    users: rooms[roomName].users.map(u => ({ username: u.username, isAdmin: u.isAdmin }))
                 });

            }

            // Eğer oda boşaldıysa, odayı sil
            if (rooms[roomName].users.length === 0) {
                delete rooms[roomName];
                console.log(`Room ${roomName} deleted because it's empty.`);
            }

            // Kullanıcıyı bulduğumuz ve işlediğimiz için döngüden çıkabiliriz
            break;
        }
    }
    return { roomName: roomUserLeft, user: leavingUser }; // Return room name and the user object
}


io.on('connection', (socket) => {
    console.log('A new user connected:', socket.id);

     socket.emit('id', socket.id);

    // Kullanıcının şu anki odasını takip etmek için
    let currentUserRoom = null;
    // Kullanıcının kendi bilgilerini saklamak için (isAdmin kontrolü için)
    let currentUserInfo = null;


    // --- Room Creation and Joining Logic (Modified to store currentUserInfo) ---

    socket.on('createRoom', (data) => {
        const { roomName, username, password } = data;
        const trimmedUsername = username ? username.trim() : '';

        // ... (validations remain the same) ...
         if (!trimmedUsername) {
             socket.emit('roomCreation', { success: false, message: 'Valid username required.' });
             return;
         }
         if (!roomName) {
             socket.emit('roomCreation', { success: false, message: 'Room name required.' });
             return;
        }
        if (!password) {
            socket.emit('roomCreation', { success: false, message: 'Password required to create a room.' });
            return;
        }
        if (rooms[roomName]) {
            socket.emit('roomCreation', { success: false, message: 'This room name is already taken.' });
            return;
        }


        rooms[roomName] = {
            users: [],
            password: password
        };
        console.log(`New room created: ${roomName} (Password Protected)`);

        // Oda oluşturucusunu admin olarak ekle
        const creator = { id: socket.id, username: trimmedUsername, isAdmin: true };
        rooms[roomName].users.push(creator);
        console.log(`${trimmedUsername} joined ${roomName} as admin (Creator).`);

        currentUserRoom = roomName; // Track user's room
        currentUserInfo = creator; // Store user's info including isAdmin status
        socket.join(roomName);

        socket.emit('roomCreation', { success: true, message: `Room ${roomName} created successfully.` });
        socket.emit('joinedRoom', {
             success: true,
             roomName: roomName,
             username: trimmedUsername,
             isAdmin: true,
             message: `Successfully joined ${roomName} as admin.`
         });
        socket.emit('roomUsers', {
             message: `Welcome to the room, ${trimmedUsername}!`,
             users: rooms[roomName].users.map(u => ({ username: u.username, isAdmin: u.isAdmin }))
        });
    });

    socket.on('joinRoom', (data) => {
        const { roomName, username, password } = data;
        const trimmedUsername = username ? username.trim() : '';

        // ... (validations remain the same) ...
         if (!trimmedUsername) {
             socket.emit('joinedRoom', { success: false, message: 'Valid username required.' });
             return;
         }
         if (!roomName) {
             socket.emit('joinedRoom', { success: false, message: 'Room name required.' });
             return;
         }
         if (!password) {
             socket.emit('joinedRoom', { success: false, message: 'Password required to join.' });
             return;
         }
         if (!rooms[roomName]) {
             socket.emit('joinedRoom', { success: false, message: 'Room not found.' });
             console.log(`Join attempt failed: Room ${roomName} does not exist.`);
             return;
         }
         if (rooms[roomName].password !== password) {
             socket.emit('joinedRoom', { success: false, message: 'Incorrect room password.' });
             console.log(`Join attempt failed for ${trimmedUsername} in ${roomName}: Wrong password.`);
             return;
         }
         if (rooms[roomName].users.length >= 3) { // Assuming max 3 users
             socket.emit('joinedRoom', { success: false, message: 'Room is full.' });
             return;
         }
         const isUsernameTaken = rooms[roomName].users.some(user => user.username.toLowerCase() === trimmedUsername.toLowerCase());
         if (isUsernameTaken) {
             socket.emit('joinedRoom', { success: false, message: `Username "${trimmedUsername}" is already taken in this room.` });
             console.log(`Join attempt failed for ${trimmedUsername} in ${roomName}: Username taken.`);
             return;
         }


        // Yeni katılan kullanıcı admin DEĞİL
        const newUser = { id: socket.id, username: trimmedUsername, isAdmin: false };
        rooms[roomName].users.push(newUser);
        console.log(`${trimmedUsername} joined ${roomName}.`);

        currentUserRoom = roomName; // Track user's room
        currentUserInfo = newUser; // Store user's info
        socket.join(roomName);

        socket.emit('joinedRoom', {
            success: true,
            roomName: roomName,
            username: trimmedUsername,
            isAdmin: false,
            message: `Successfully joined ${roomName}.`
        });
        io.to(roomName).emit('roomUsers', {
            message: `${trimmedUsername} joined the room.`,
            users: rooms[roomName].users.map(u => ({ username: u.username, isAdmin: u.isAdmin }))
        });
    });

     // --- Message Sending (Remains the same) ---
    socket.on('sendMessage', (messageData) => {
        const { roomName, sender, receiver, message, translate } = messageData;

        if (!currentUserRoom || currentUserRoom !== roomName || !rooms[roomName] || !currentUserInfo) {
             console.error(`Error: User (${socket.id}) is not in a valid room (${roomName || 'unknown'}) or user info missing. Message not sent.`);
             return;
         }

        const timestamp = new Date().toISOString();
        const messageJson = {
            senderId: socket.id,
            senderUsername: currentUserInfo.username, // Use stored username
            receiver,
            message,
            translate,
            timestamp,
            isAdmin: currentUserInfo.isAdmin // Use stored admin status
        };

        console.log(`Message (${roomName}):`, messageJson);
        io.to(roomName).emit('receiveMessage', messageJson);
    });

    // --- NEW: Kick User Event Handler ---
    socket.on('kickUser', (data) => {
        const { roomName, targetUsername } = data;

        // 1. Validation and Permission Check
        if (!currentUserRoom || currentUserRoom !== roomName || !rooms[roomName] || !currentUserInfo) {
            console.error(`Kick attempt failed: User ${socket.id} not properly in room ${roomName}.`);
            socket.emit('kickResult', { success: false, message: 'Error: You are not currently in this room.' });
            return;
        }
        if (!currentUserInfo.isAdmin) {
            console.log(`Kick attempt failed: User ${currentUserInfo.username} (${socket.id}) is not admin in ${roomName}.`);
            socket.emit('kickResult', { success: false, message: 'Only the room admin can kick users.' });
            return;
        }
        if (!targetUsername) {
             socket.emit('kickResult', { success: false, message: 'You must specify a username to kick.' });
             return;
        }

        // 2. Find Target User
        const targetUserIndex = rooms[roomName].users.findIndex(user => user.username.toLowerCase() === targetUsername.toLowerCase());

        if (targetUserIndex === -1) {
            console.log(`Kick attempt failed: User "${targetUsername}" not found in room ${roomName}.`);
            socket.emit('kickResult', { success: false, message: `User "${targetUsername}" not found in this room.` });
            return;
        }

        const targetUser = rooms[roomName].users[targetUserIndex];

        if (targetUser.id === socket.id) {
            console.log(`Kick attempt failed: Admin ${currentUserInfo.username} tried to kick themselves.`);
            socket.emit('kickResult', { success: false, message: 'You cannot kick yourself.' });
            return;
        }

        // 3. Perform Kick
        console.log(`Admin ${currentUserInfo.username} is kicking ${targetUser.username} (${targetUser.id}) from ${roomName}.`);

        // Find the socket of the user to be kicked
        const targetSocket = io.sockets.sockets.get(targetUser.id);

        if (targetSocket) {
            // Notify the kicked user
            targetSocket.emit('kicked', {
                roomName: roomName,
                reason: `You were kicked from the room by the admin (${currentUserInfo.username}).`
            });
            // Make them leave the Socket.IO room
            targetSocket.leave(roomName);
             // Optional: Disconnect the user entirely after kicking
             // targetSocket.disconnect(true); // Uncomment if you want to force disconnect

             // Update server state and notify others using the helper function
            handleUserLeave(targetUser.id, roomName, true, currentUserInfo.username); // Pass kicked=true and admin username

            // Notify the admin that the kick was successful
            socket.emit('kickResult', { success: true, message: `Successfully kicked ${targetUser.username}.` });

        } else {
            console.error(`Kick error: Could not find the socket for user ${targetUser.username} (${targetUser.id}). Removing from list anyway.`);
             // If the socket isn't found (maybe they disconnected abruptly?), still remove them from the list
             handleUserLeave(targetUser.id, roomName, true, currentUserInfo.username);
             socket.emit('kickResult', { success: false, message: `Could not directly notify ${targetUser.username}, but they have been removed from the room.` });
        }
         console.log("Room status after kick:", rooms[roomName] ? rooms[roomName].users : 'Room deleted');


    });


    // --- Leave Room ---
    socket.on('leaveRoom', () => {
        if (currentUserRoom) {
            console.log(`${currentUserInfo?.username || socket.id} is manually leaving ${currentUserRoom}.`);
            handleUserLeave(socket.id, currentUserRoom); // Kicked=false (default)
            socket.leave(currentUserRoom);
            socket.emit('leftRoom', {success: true, message: 'You have left the room.'}) // İstemciye bilgi ver
            currentUserRoom = null;
            currentUserInfo = null;
        } else {
            console.log(`${socket.id} tried to leave but wasn't in a room.`);
            socket.emit('leftRoom', {success: false, message: 'You are not currently in a room.'})
        }
         console.log("Current rooms state:", rooms);
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id, `(was in room: ${currentUserRoom || 'none'})`);
        if (currentUserRoom) {
             // Pass the username of the disconnecting user if available for logging in handleUserLeave
            handleUserLeave(socket.id, currentUserRoom, false, currentUserInfo?.username);
        } else {
             // If user disconnected before joining a room, check all rooms just in case
             // (though less likely with current logic)
             handleUserLeave(socket.id);
        }
        // Clear local variables regardless
        currentUserRoom = null;
        currentUserInfo = null;
        console.log("Current rooms state after disconnect:", rooms);
    });

});

// ... (server listen remains the same) ...
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}.`);
});
