'use strict';

/* App Module */

var calaos =  angular.module('calaos', ['ui.bootstrap']);



calaos.config(['$routeProvider', function($routeProvider) {
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

calaos.directive('contentItem', function ($compile) {
    var linker = function(scope, element, attrs) {
    }
    var intenalIntTemplate = '<h3>{{content.name}}<h3><div><input type="checkbox" checked></div>';

    var getTemplate = function(contentType) {
        var template = '';
        switch(contentType) {
	case 'InternalInt':
            template = intenalIntTemplate;
            break;
/*
       case 'light':
            template = firstTemplate;
            break;
        case 'temp':
            template = secondTemplate;
            break;
        case 'analog_in':
            template = thirdTemplate;
            break;
	case 'analog_out':
            template = thirdTemplate;
            break;
	case 'light_dimmer':
            template = thirdTemplate;
            break;
	case 'light_rgb':
            template = thirdTemplate;
            break;
	case 'shutter':
            template = thirdTemplate;
            break;
	case 'shutter_mart':
            template = thirdTemplate;
            break;
	case 'var_bool':
	    template = thirdTemplate;
	    break;
	case 'var_int':
            template = thirdTemplate;
            break;
	case 'var_string':
	    template = thirdTemplate;
	    break;
	case 'scenario':
	    template = thirdTemplate;
	    break;
*/
	}
	console.log("return " + template);
	return template;
    }

    var linker = function(scope, element, attrs) {
        scope.rootDirectory = 'images/';

	console.log(scope.content.type);
        element.html(getTemplate(scope.content.type));

        $compile(element.contents())(scope);
    }

    return {
        restrict: "E",
        rep1ace: true,
        link: linker,
        scope: {
            content:'='
        }
    };
});
