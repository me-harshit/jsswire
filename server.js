const socketio = require('socket.io');
const express = require('express');
const http = require('http');

require("dotenv").config();
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");

const { disconnect } = require('process');
const { listen } = require('socket.io');
const formatMessage = require('./utility/messages')
const { userJoin, getCurrentUser, userLeave, getRoomUsers } = require('./utility/users')

const app = express();
const server = http.createServer(app);
const io = socketio(server);


// Authentication starts

//List of letiables

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

const MONGODB_URI = 'mongodb+srv://Harshit:Harshit@JSS@resources.jrm24.gcp.mongodb.net/resources?retryWrites=true&w=majority'
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});
mongoose.set("useCreateIndex", true);
const db = mongoose.connection;

db.on('connected', () => {
    console.log('Mongoose is connected!');
});

mongoose.set("useCreateIndex", true);

app.use('/public', express.static('public'));
app.use('/views', express.static(__dirname + '/views'));

app.use(bodyParser.urlencoded({ extended: true }));


//body-parser
app.use(bodyParser.json());
const userSchema = new mongoose.Schema({
    email: String,
    picture: String,
    name: String,
    googleId: String
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const wireUser = mongoose.model("wireUser", userSchema);
passport.use(wireUser.createStrategy());

passport.serializeUser(function (user, done) {
    done(null, user.id);

});

passport.deserializeUser(function (id, done) {
    wireUser.findById(id, function (err, user) {
        done(err, user);
    });
});
let myEmail = "";

// Userblogs Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "https://jsswire.herokuapp.com/auth/google/join",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
},
    function (accessToken, refreshToken, profile, cb) {
        console.log(profile);
        wireUser.findOrCreate({ googleId: profile.id, name: profile.displayName, picture: profile.photos[0].value, email: profile.emails[0].value }, function (err, user) {

            console.log(user);
            myEmail = user.email;
            return cb(err, user);
        });


    }
));

//Now the profile will be updated only when the user is authenticated

app.get(`/profile/:token`, (req, res) => {
    const token1 = req.params.token;
    console.log("token1");
    console.log(token1);
    passport.authenticate('google', { failureRedirect: '/login' });
    if (req.isAuthenticated()) {

        wireUser.find({ email: token1 }, (err, user) => {
            if (err) {
                console.log(err);
            }
            else {
                res.send(user);
            }
        })
    }
})

app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', "email"] })
);
//

app.get('/auth/google/join',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function (req, res) {
        // Successful authentication, redirect home.
        res.redirect(`/join?email=${myEmail}`);
    });

app.get('/auth/google/publicchat',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function (req, res) {
        // Successful authentication, redirect public.
        res.redirect('/publicchat');
    });
app.get('/auth/google/private',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function (req, res) {
        // Successful authentication, redirect private.
        res.redirect('/private');
    });

app.get('/auth/google/chat',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function (req, res) {
        // Successful authentication, redirect userblog.
        res.redirect('/chat')
    });

app.get("/logout", function (req, res) {
    req.logOut();
    res.redirect("/login");
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/views/index.html");
})

app.get("/login", (req, res) => {
    res.sendFile(__dirname + "/views/login.html");
})
app.get("/join", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(__dirname + "/views/join.html");
    }
    else {
        res.redirect("/login");
    }
})
app.get("/private", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(__dirname + "/views/private.html");
    }
    else {
        res.redirect("/login");
    }
})
app.get("/publicchat", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(__dirname + "/views/publicchat.html");
    }
    else {
        res.redirect("/login");
    }
})
app.get("/chat", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(__dirname + "/views/chat.html");
    }
    else {
        res.redirect("/login");
    }
})

// Authentication ends

app.get("/index.css", (req, res) => {
    res.sendFile(__dirname + "/views/index.css")
})
app.get("/style.css", (req, res) => {
    res.sendFile(__dirname + "/views/style.css")
})
app.get("/profile.css", (req, res) => {
    res.sendFile(__dirname + "/views/profile.css")
})
app.get("/main.js", (req, res) => {
    res.sendFile(__dirname + "/views/main.js")
})


io.on('connection', (socket) => {
    socket.on("joinRoom", ({ username, room }) => {

        // welcome message
        const user = userJoin(socket.id, username, room);
        socket.join(user.room);
        socket.emit('message', formatMessage("wireBot", "Welcome to wire"));

        // Broadcast on user joining

        socket.broadcast.to(user.room).emit('message', formatMessage("wireBot", `${user.username} joined the chat`));


        // Send users and room info
        io.to(user.room).emit('roomUsers', {
            room: user.room,
            users: getRoomUsers(user.room)
        });

    })


    // listen for chat message
    socket.on("chatMessage", msg => {

        const user = getCurrentUser(socket.id);

        io.to(user.room).emit('message', formatMessage(user.username, msg));
    })

    // On client disconnection
    socket.on('disconnect', () => {

        const user = userLeave(socket.id);
        if (user) {
            io.to(user.room).emit('message', formatMessage("wireBot", `${user.username} left the chat`));


            // Send users and room info
            io.to(user.room).emit('roomUsers', {
                room: user.room,
                users: getRoomUsers(user.room)
            });
        };


    })
})


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`server is running on ${PORT}`);
});