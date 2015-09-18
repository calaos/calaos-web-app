'use strict';

angular.module('calaosApp')
.controller('RoomCtrl', ['$scope', '$state', '$stateParams', 'CalaosApp', function ($scope, $state, $stateParams, CalaosApp) {

    var home = CalaosApp.getHomeData().home;
    $scope.room = {
        name: '',
        icon: '',
        items: {
            inputs: [],
            outputs: [],
        }
    };

    if ($stateParams.roomId < 0 || $stateParams.roomId >= home.length) {
        console.log('unkown room ' + $stateParams.roomId);
        $state.go('home');
    }
    else {
        $scope.room = home[$stateParams.roomId];
    }
}]);