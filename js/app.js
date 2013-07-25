'use strict';

/* App Module */

var calaos =  angular.module('calaos', ['ui.bootstrap']);

calaos.config(['$routeProvider', function($routeProvider) {
  $routeProvider.
      when('/home',  {templateUrl: 'partials/home.html',   controller: 'HomeCtrl'}).
      when('/room/:room_name', {templateUrl: 'partials/room.html',  controller: 'RoomCtrl'}).
      when('/settings', {templateUrl: 'partials/settings.html',  controller: 'SettingsCtrl'}).
	  otherwise({redirectTo: '/home'})}]);

calaos.config(['$httpProvider', function($httpProvider) {
        $httpProvider.defaults.useXDomain = true;
        delete $httpProvider.defaults.headers.common['X-Requested-With'];
}]);

function NavBarCtrl($scope) {
    $scope.isCollapsed = true;
}
