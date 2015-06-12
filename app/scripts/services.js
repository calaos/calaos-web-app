'use strict';

angular.module('calaosApp').factory('CalaosApp', ['$rootScope', function($rootScope) {

    var connected;
    var loading;
    var homeData = {};

    var service = {
        isConnected: function() { return connected; },
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
    };

    var parseMessage = function(obj) {

    };

    var ws = new ReconnectingWebSocket('ws://xxx');
    ws.onopen = function() {
        console.log('websocket open');
        $rootScope.$apply(function() {
            connected = true;
        });

        service.send({ msg: 'login' });
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
        parseMessage(JSON.parse(received_msg));
    };

    return service;

}]);
