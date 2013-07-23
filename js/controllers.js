'use strict';

/* Controllers */

var home;

function HomeCtrl($rootScope, $scope, $http) {

    var query = {
    "cn_user": calaosConfig.cn_user,
	"cn_pass": calaosConfig.cn_pass,
	"action": "get_home"
    };

    $http.post(calaosConfig.host, query).success(function(data) {
	$scope.items = data;
	$rootScope.home = data;
	home = data;

    $scope.items.home.sort(function (rooma, roomb) { return roomb.hits - rooma.hits; });

    //create an array of max 3 rooms
    $scope.homeByRow = [];
    var a = [];
    for (var i = 0;i < $scope.items.home.length;i++) {
        $scope.items.home[i].icon = getRoomTypeIcon($scope.items.home[i].type);
        a.push(i);
        if (a.length >= 3) {
            $scope.homeByRow.push(a);
            a = [];
        }
    }
    if (a.length > 0) $scope.homeByRow.push(a);

    console.log(home);
    });
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
