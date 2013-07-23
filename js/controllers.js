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
    var cpt = 0;
    for (var i = 0;i < $scope.items.home.length;i++) {
        a.push(i);
        cpt++;
        if (cpt >= 3) {
            $scope.homeByRow.push(a);
            a = [];
            cpt = 0;
        }
    }

    console.log(home);

    for(var i=0; i< data.home.length; i++) {

	switch(home.home[i].type)
	{
	case "salon":
	    home.home[i].type = "lounge";
	    break;
	case "sam":
	    home.home[i].type = "dinningroom";
	    break;
	default:
	    home.home[i].type = "various";
	    break;
	}

    }
    });


//    $scope.orderProp = 'hint';
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
