'use strict';

angular.module('calaosApp').factory('CalaosApp',
    ['$rootScope', '$state', function($rootScope, $state) {

    var connected = false;
    var loading = false;
    var auth = false;
    var auth_failed = false;
    var calaos_user = '';
    var calaos_pass = '';

    var homeData = {};

    //those are the cache input and output tables
    //they are used to quickly query for an IO without
    //having to look over all rooms
    var inputCache = [];
    var outputCache = [];

    var service = {
        isConnected: function() { return connected; },
        isAuth: function() { return auth; },
        hasAuthFailed: function() { return auth_failed; },
        isLoading: function() { return loading; },
        getHomeData: function() { return homeData; },

        send: function(data) {
            if (angular.isString(data)) {
                ws.send(data);
            }
            else if (angular.isObject(data)) {
                ws.send(JSON.stringify(data));
            }
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

            //fill cache
            for (var i = 0;i < homeData.home.length;i++) {
                homeData.home[i].icon = getRoomTypeIcon(homeData.home[i].type);

                if (homeData.home[i].items.inputs) {
                    for (var io = 0;io < homeData.home[i].items.inputs.length;io++) {
                        inputCache[homeData.home[i].items.inputs[io].id] = homeData.home[i].items.inputs[io];
                    }
                }

                if (homeData.home[i].items.outputs) {
                    for (var io = 0;io < homeData.home[i].items.outputs.length;io++) {
                        outputCache[homeData.home[i].items.outputs[io].id] = homeData.home[i].items.outputs[io];
                    }
                }
            }

            loading = false;
            $state.go('home');
        }
    };

    var getHost = function() {

        if (calaosDevConfig.calaosServerHost !== '')
            return calaosDevConfig.calaosServerHost;

        var h = window.location.protocol === 'http:'?'ws://':'wss://';
        h += window.location.hostname + ':' +
             window.location.port + '/api/v3';

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
        });
    };
    ws.onerror = function() {
        console.log('websocket error');
        $rootScope.$apply(function() {
            connected = false;
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
