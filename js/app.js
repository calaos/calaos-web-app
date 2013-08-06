'use strict';

/* App Module */

var calaos =  angular.module('calaos', ['ui.bootstrap']);

calaos.config(['$routeProvider', function($routeProvider) {
    var device = isMobile?'mobile':'desktop';

    $routeProvider.
      when('/load', {templateUrl: 'partials/loading.html'}).
      when('/mobile/home',  {templateUrl: 'partials/mobile/home.html',   controller: 'RoomsListCtrl'}).
      when('/mobile/room/:room_name', {templateUrl: 'partials/mobile/room.html',  controller: 'RoomCtrl'}).
      when('/mobile/settings', {templateUrl: 'partials/mobile/settings.html',  controller: 'SettingsCtrl'}).
      when('/desktop/home',  {templateUrl: 'partials/desktop/home.html',   controller: 'RoomsListCtrl'}).
      when('/desktop/room/:room_name', {templateUrl: 'partials/desktop/room.html',  controller: 'RoomCtrl'}).
      when('/desktop/settings', {templateUrl: 'partials/desktop/settings.html',  controller: 'SettingsCtrl'}).
	  otherwise({redirectTo: '/load'})}]);

calaos.config(['$httpProvider', function($httpProvider) {
    $httpProvider.defaults.useXDomain = true;
    delete $httpProvider.defaults.headers.common['X-Requested-With'];
}]);

function NavBarCtrl($scope) {
    $scope.isCollapsed = true;
}
