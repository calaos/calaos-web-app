'use strict';

/* App Module */

var calaos =  angular.module('calaos', []);

calaos.config(['$routeProvider', function($routeProvider) {
  $routeProvider.
      when('/home',  {templateUrl: 'partials/home.html',   controller: 'HomeCtrl'}).
      when('/room/:room_name', {templateUrl: 'partials/room.html',  controller: 'RoomCtrl'}).
	  otherwise({redirectTo: '/home'})}]);

calaos.config(['$httpProvider', function($httpProvider) {
        $httpProvider.defaults.useXDomain = true;
        delete $httpProvider.defaults.headers.common['X-Requested-With'];
}]);
