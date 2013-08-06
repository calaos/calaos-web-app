'use strict';

/* Controllers */

var home;

function CalaosMainController($rootScope, $scope, $routeParams, $http, $location) {
    //setup everything calaos needs here,
    //and do the get_home api call to get the entire house
    //also start the event polling timer here

    var query = {
        "cn_user": calaosConfig.cn_user,
        "cn_pass": calaosConfig.cn_pass,
        "action": "get_home"
    };

    $http.post(calaosConfig.host, query)
        .success(function(data) {
            $rootScope.homeRaw = data;
            
            $location.path('/'+(isMobile?'mobile':'desktop')+'/home');
        })
        .error(function(data, status) {
            //todo, handle error here
        }); 
}

function RoomsListCtrl($rootScope, $scope, $http, $location) {

    if (typeof $rootScope.homeRaw === "undefined") {
        $location.path('/load');
        return;
    }

    $rootScope.homeRaw.home.sort(function (rooma, roomb) { return roomb.hits - rooma.hits; });

    //create an array of max 3 rooms
    $scope.homeByRow = [];
    var a = [];
    for (var i = 0;i < $rootScope.homeRaw.home.length;i++) {
        $rootScope.homeRaw.home[i].icon = getRoomTypeIcon($rootScope.homeRaw.home[i].type);
        a.push(i);
        if (a.length >= 3) {
            $scope.homeByRow.push(a);
            a = [];
        }
    }
    if (a.length > 0) $scope.homeByRow.push(a);
}

function RoomCtrl($rootScope, $scope, $routeParams, $http) {

    var query = {
	"cn_user": calaosConfig.cn_user,
	"cn_pass": calaosConfig.cn_pass,
	"action": "get_state",
	"inputs": ["input_0"],
	"outputs": ["output_0", "output_1"],
	"audio_players": ["0"]
    };

    $http.post(calaosConfig.host, query).success(function(data) {

	for(var i=0; i< home.home.length; i++) {
    	    if (home.home[i].name == $routeParams.room_name)
	    {
    		$scope.room = home.home[i];
    		$scope.values = data;
    		break;
	    }
	}

    });

}

function MenuController($scope) {

}

function SettingsCtrl($scope) {

    var tmp = getCookie('cn_user');
    if (tmp) {
	$scope.cn_user = tmp;
    }
    var tmp = getCookie('cn_pass');
    if (tmp) {
	$scope.cn_pass = tmp;
    }
    var tmp = getCookie('use_calaosnetwork');
    if (tmp) {
	if (tmp == "true")
	    $scope.use_calaos_network = true;
	else
	    $scope.use_calaos_network = false;
    } else  {
	var tmp = getCookie('host');
	if (tmp) {
	    $scope.host = tmp;
	}
    }

    $scope.sign_in = function () {
	setCookie('cn_user', $scope.cn_user, 365);
	setCookie('cn_pass', $scope.cn_pass, 0);
	setCookie('use_calaosnetwork', $scope.use_calaosnetwork, 365);
	setCookie('host', $scope.host, 365);
    }
}
