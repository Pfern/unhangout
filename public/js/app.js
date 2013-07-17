var sock;

var curEvent, users, messages;

var app;

var curSession = null;

// handle IE not having console.log
if (typeof console === "undefined" || typeof console.log === "undefined") {
     console = {};
     console.log = function() {};
}



$(document).ready(function() {
	if($("#main").length!=1) {
		console.log("Code running on a page that does not have an #app div.");
		return;
	}

	console.log("Starting app!");

	curEvent = new models.ClientEvent(EVENT_ATTRS);
	
	users = new models.UserList(EVENT_ATTRS.connectedUsers);
	
	curEvent.get("sessions").add(EVENT_ATTRS.sessions);

	if(SINGLE_SESSION_RSVP) {
		curEvent.get("sessions").each(function(session) {
			if(session.isAttending(USER_ID)) {
				curSession = session.id;
			}
		})
	}

	$("#sessions-nav").find("a").text("Sessions (" + curEvent.get("sessions").length + ")");
	
	messages = new models.ChatMessageList();
	
	console.log("Inflated models.");

	app = new Backbone.Marionette.Application();
	
	app.addRegions({
		// top: '#top',
		right: '#main-right',
		main: '#main-left',
		global: '#global',
		dialogs: '#dialogs',
		admin: '#admin-region'
	});
	
	app.addInitializer(function(options) {
		
		// include the youtube JS api per docs:
	    // https://developers.google.com/youtube/iframe_api_reference
	    var tag = document.createElement('script');
	    tag.src = "//www.youtube.com/iframe_api";
	    var firstScriptTag = document.getElementsByTagName('script')[0];
	    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

	    window.onYouTubeIframeAPIReady = _.bind(function(playerId) {
			this.vent.trigger("youtube-ready");
	    }, this);
		
		this.sessionListView = new SessionListView({collection: curEvent.get("sessions")});
		this.chatView = new ChatLayout({messages:messages, users:users});
		this.youtubeEmbedView = new VideoEmbedView({model:curEvent});
		this.dialogView = new DialogView();

		// this.top.show(this.sessionListView);
		this.right.show(this.chatView);
		this.main.show(this.sessionListView);
		this.dialogs.show(this.dialogView);
		
		if(IS_ADMIN) {
			this.adminButtonView = new AdminButtonView();
			this.admin.show(this.adminButtonView);
		}


		// set up some extra methods for managing show/hide of top region.
		// this.topShown = false;
		
		// this.hideTop = _.bind(function() {
		// 	this.top.$el.animate({
		// 		top: -this.top.$el.outerHeight(),
		// 	}, 500, "swing", _.bind(function() {
		// 			this.topShown = false;
		// 		}, this));
				
		// 	this.main.$el.find("#chat-container").animate({
		// 		top: 0
		// 	}, 500, "swing")
				
		// }, this);
		
		// this.showTop = _.bind(function() {
		// 	this.top.$el.animate({
		// 		top: 0,
		// 	}, 500, "swing", _.bind(function() {
		// 		this.topShown = true;
		// 	}, this));
			
		// 	// hardcoded a bit, but we don't use main for anything else right now.
		// 	this.main.$el.find("#chat-container").animate({
		// 		top: this.top.$el.outerHeight()
		// 	}, 500, "swing")
			
		// }, this);
				
		// // start sessions open, but triggering it properly.
		// this.top.$el.css("top", -this.top.$el.outerHeight());
				
		console.log("Initialized app.");
	});

	app.vent.on("sessions-nav", _.bind(function() {
		this.main.show(this.sessionListView);
	}, app));

	app.vent.on("video-nav", _.bind(function() {
		this.main.show(this.youtubeEmbedView);
	}, app));
	
	app.vent.on("youtube-ready", _.bind(function() {
		console.log("YOUTUBE READY");
		// this.global.show(this.youtubeEmbedView);
	}, app));
	
	app.start();
	app.vent.trigger("sessions-nav");

	$("#video-nav, #sessions-nav").click(function() {
		$(".nav .active").removeClass("active");
		$(this).addClass("active");
		console.log("triggering: " + $(this).attr("id"));
		app.vent.trigger($(this).attr("id"));
	})
	
	console.log("Setup regions.");

	sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
	sock.onopen = function() {
		console.log('open');
		
		var AUTH = {type:"auth", args:{key:SOCK_KEY, id:USER_ID}};
		
		sock.send(JSON.stringify(AUTH));
	};
	sock.onmessage = function(message) {
		console.log(message);
		var msg = JSON.parse(message.data);
		
		if(msg.type.indexOf("-err")!=-1) {
			console.log("Got an error from the server!");
		}
		
		switch(msg.type) {
			case "attend":
				curEvent.get("sessions").get(msg.args.id).addAttendee(msg.args.user);
				console.log("added attendee to a session");

				if(SINGLE_SESSION_RSVP && msg.args.user.id==USER_ID) {

					if(!_.isNull(curSession)) {
						var message = {type:"unattend", args:{id:curSession}};
						sock.send(JSON.stringify(message));				
					}

					curSession = msg.args.id;
				}
				break;
			
			case "first-attendee":
				curEvent.get("sessions").get(msg.args.id).setFirstAttendee(msg.args.user);
				console.log("set first attendee");
				break;
			
			case "unattend"	:
				curEvent.get("sessions").get(msg.args.id).removeAttendee(msg.args.user);
				console.log("removed attendee from a session");
				break;
			
			case "join":
				console.log("join: " + JSON.stringify(msg.args));
				users.add(new models.User(msg.args.user));
				break;
			
			case "leave":
				users.remove(users.get(msg.args.user.id));
				break;
				
			case "chat":
				messages.add(new models.ChatMessage(msg.args));
				break;
			
			case "embed":
				curEvent.setEmbed(msg.args.ytId);
				console.log("added yt embed id");
				break;
				
			case "start":
				// this is a little wacky, but we want to give people who RSVP'd a chance to join first.
				// so we're going to do two things here: 
				// 1) if not rsvp, delay triggering start and setting the session key.
				// 2) if not rsvp, supress the dialog popup
				var session = curEvent.get("sessions").get(msg.args.id);
				
				var timeout = 0;
				
				if(!(session.isAttending(USER_ID))) {
					timeout = 60*1000;
				}
				
				setTimeout(function() {
					session.set("session-key", msg.args.key);
					session.start();
				}, timeout);
				
				break;
			case "auth-ack":
				sock.send(JSON.stringify({type:"join", args:{id:curEvent.id}}));
				break;
				
			case "embed-ack":
				$("#embed-modal").modal('hide');
				break;
				
			case "join-ack":
				console.log("joined!");
				break;

			case "attend-ack":
				setTimeout(function() {
					app.vent.trigger("sessions-button");
					$("#sessions-nav").tooltip("show");
					setTimeout(function() {
						$("#sessions-nav").tooltip("hide");
					}, 5000);

				}, 500);
				break;
		}
	};

	sock.onclose = function() {
		console.log('close');
	};
});