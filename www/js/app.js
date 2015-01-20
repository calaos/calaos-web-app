'use strict';

/* App Module */

var calaos =  angular.module('calaos', ['ngRoute', 'ngAnimate', 'ngTouch', 'ngDialog', 'farbtastic']);

calaos.config(['$routeProvider', function($routeProvider) {

    var device = getDevice();
            
    $routeProvider.
      when('/mobile/home',  {templateUrl: 'partials/mobile/home.html',   controller: 'RoomsListCtrl'}).
      when('/mobile/audio',  {templateUrl: 'partials/mobile/audio.html',   controller: 'AudioCtrl'}).
      when('/mobile/cameras',  {templateUrl: 'partials/mobile/cameras.html',   controller: 'CamerasCtrl'}).
      when('/mobile/room/:room_name', {templateUrl: 'partials/mobile/room.html',  controller: 'RoomCtrl'}).
      when('/mobile/audio/:player_id', {templateUrl: 'partials/mobile/audio_player.html',  controller: 'AudioPlayerCtrl'}).
      when('/mobile/settings', {templateUrl: 'partials/mobile/settings.html',  controller: 'SettingsCtrl'}).
      when('/mobile/color-picker', {templateUrl: 'partials/mobile/color-picker.html',  controller: 'ColorPickerCtrl'}).
      when('/desktop/home',  {templateUrl: 'partials/desktop/home.html',   controller: 'RoomsListCtrl'}).
      when('/desktop/room/:room_name', {templateUrl: 'partials/desktop/room.html',  controller: 'RoomCtrl'}).
      when('/desktop/audio',  {templateUrl: 'partials/desktop/audio.html',   controller: 'AudioCtrl'}).
      when('/desktop/audio/:player_id', {templateUrl: 'partials/desktop/audio_player.html',  controller: 'AudioPlayerCtrl'}).
      when('/desktop/cameras',  {templateUrl: 'partials/desktop/cameras.html',   controller: 'CamerasCtrl'}).
    otherwise({redirectTo: '/' + device + '/home'})
}]);

calaos.config(['$httpProvider', function($httpProvider) {
    $httpProvider.defaults.useXDomain = true;
    delete $httpProvider.defaults.headers.common['X-Requested-With'];
}]);

calaos.config(['$sceDelegateProvider', function($sceDelegateProvider) {
    $sceDelegateProvider.resourceUrlWhitelist(['self', '*']);
}])

var app = {
    // Application Constructor
    initialize: function() {
        this.bindEvents();
    },
    // Bind Event Listeners
    //
    // Bind any events that are required on startup. Common events are:
    // 'load', 'deviceready', 'offline', and 'online'.
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
    },
    // deviceready Event Handler
    //
    // The scope of 'this' is the event. In order to call the 'receivedEvent'
    // function, we must explicity call 'app.receivedEvent(...);'
    onDeviceReady: function() {
        app.receivedEvent('deviceready');
    },
    // Update DOM on a Received Event
    receivedEvent: function(id) {
        var parentElement = document.getElementById(id);
        var listeningElement = parentElement.querySelector('.listening');
        var receivedElement = parentElement.querySelector('.received');

        listeningElement.setAttribute('style', 'display:none;');
        receivedElement.setAttribute('style', 'display:block;');

        console.log('Received Event: ' + id);
    }
};
