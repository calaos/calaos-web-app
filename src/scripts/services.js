'use strict';

angular.module('calaosApp').factory('CalaosApp',
    ['$rootScope', '$state', '$timeout', function($rootScope, $state, $timeout) {

    var connected = false;
    var loading = false;
    var auth = false;
    var auth_failed = false;
    var calaos_user = '';
    var calaos_pass = '';

    var homeData = {};
    var homeSortedByRow = [];

    //this is the cache for IOs
    //they are used to quickly query for an IO without
    //having to look over all rooms
    var ioCache = [];

    var service = {
        isConnected: function() { return connected; },
        isAuth: function() { return auth; },
        hasAuthFailed: function() { return auth_failed; },
        isLoading: function() { return loading; },
        getHomeData: function() { return homeData; },
        getSortedHomeByRow: function() { return homeSortedByRow; },

        send: function(data) {
            if (angular.isString(data)) {
                ws.send(data);
            }
            else if (angular.isObject(data)) {
                ws.send(JSON.stringify(data));
            }
        },

        setState: function(item, state) {
            service.send({
                msg: 'set_state',
                data: {
                    id: item.id,
                    value: state,
                },
            });
        },

        signIn: function (cuser, cpass) {

            loading = true;
            auth_failed = false;
            auth = false;
            calaos_user = cuser;
            calaos_pass = cpass;

            console.log('Trying to sign in with ' + calaos_user);

            if (connected) {
                service.send({
                    msg: 'login',
                    data: {
                        cn_user: calaos_user,
                        cn_pass: calaos_pass,
                    },
                });
            }
        },

        signOut: function () {
            loading = false;
            auth_failed = false;
            auth = false;
            calaos_user = '';
            calaos_pass = '';
            homeData = '';
            homeSortedByRow = '';
        },
    };

    var parseMessage = function(obj) {

        if (obj.msg == 'login' && !auth) {
            if (obj.data.success !== 'true') {
                auth_failed = true;
                auth = false;
            }
            else {
                auth = true;

                //query the complete house config
                service.send({ msg: 'get_home' });
            }
        }
        else if (obj.msg == 'get_home') {

            homeData = obj.data;

            //sort rooms
            homeData.home.sort(function (rooma, roomb) {
                return roomb.hits - rooma.hits;
            });

            homeSortedByRow = [];
            var a = [];

            //fill cache
            for (var i = 0;i < homeData.home.length;i++) {
                homeData.home[i].icon = getRoomTypeIcon(homeData.home[i].type);
                homeData.home[i].roomId = i;

                if (homeData.home[i].items) {
                    for (var io = 0;io < homeData.home[i].items.length;io++) {
                        ioCache[homeData.home[i].items[io].id] = homeData.home[i].items[io];
                    }
                }

                a.push(i);
                if (a.length >= 3) {
                    homeSortedByRow.push(a);
                    a = [];
                }
            }
            if (a.length > 0)
                homeSortedByRow.push(a);

            loading = false;

            //delay a bit the change of page to show login animation
            $timeout(function () {
                $state.go('home.list');
            }, 1500);

        }
        else if (obj.msg == 'event') {
            var event = obj.data;

            console.debug("Received event: ", event);

            if (event.type_str == 'io_changed' &&
                ioCache.hasOwnProperty(event.data.id)) {

                if (event.data.hasOwnProperty('state'))
                    ioCache[event.data.id].state = event.data.state;

                if (event.data.hasOwnProperty('name'))
                    ioCache[event.data.id].name = event.data.name;
            }
            else {
                //TODO: implement other events here:
                //new_io
                //delete_io
                //modify_room, delete_room, new_room
                //audio_volume, audio_status
                //audio songchanged
                console.debug('Event not implemented!');
            }
        }
    };

    var getHost = function() {

        if (calaosDevConfig.calaosServerHost !== '')
            return calaosDevConfig.calaosServerHost;

        var h = window.location.protocol === 'http:'?'ws://':'wss://';
        h += window.location.hostname + ':' +
             window.location.port + '/api';

        console.log('Connecting to ' + h);
        return h;
    }

    var ws = new ReconnectingWebSocket(getHost());
    ws.onopen = function() {
        console.log('websocket open');
        $rootScope.$apply(function() {
            connected = true;
        });

        if (!auth_failed) {
            service.send({
                msg: 'login',
                data: {
                    cn_user: calaos_user,
                    cn_pass: calaos_pass,
                },
            });
        }
    };

    ws.onclose = function() {
        console.log('websocket closed');
        $rootScope.$apply(function() {
            connected = false;
            loading = false;
        });
    };
    ws.onerror = function() {
        console.log('websocket error');
        $rootScope.$apply(function() {
            connected = false;

            $timeout(function () {
                service.signOut();
                $state.go('login');
            }, 200);
        });
    };
    ws.onmessage = function(evt) {
        var received_msg = evt.data;
        $rootScope.$apply(function() {
            parseMessage(JSON.parse(received_msg));
        });
    };

    return service;

}]);
