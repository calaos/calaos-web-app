'use strict';

/* Controllers */

var home;

function HomeCtrl($rootScope, $scope, $http) {

    var query = {
	"cn_user": "alex",
	"cn_pass": "qt4biasd",
	"action": "get_home"
    };

    $http.post('http://127.0.0.1/api.php', query).success(function(data) {
	$scope.items = data;
	$rootScope.home = data;
	home = data;
    console.log("HomeCtrl");
	console.log($rootScope.home);
    });
    console.log($rootScope);
  $scope.orderProp = 'hint';
}

function RoomCtrl($rootScope, $scope, $routeParams, $http) {

    var query = {
	"cn_user": "alex",
	"cn_pass": "qt4biasd",
	"action": "get_state",
	"inputs": ["input_0"],
	"outputs": ["output_0", "output_1"],
	"audio_players": ["0"]
    };
    
    $http.post('http://127.0.0.1/api.php', query).success(function(data) {
    console.log("RoomCtrl");
    console.log(home.home);
    	
    for(var i=0; i< home.home.length; i++) {
    	console.log(home.home[i].name);
        	
    	if (home.home[i].name == $routeParams.room_name)
		{
    		$scope.room = home.home[i];
    		$scope.values = data;
    		break;
		}
    }

    });

}
