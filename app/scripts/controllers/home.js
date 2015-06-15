'use strict';

angular.module('calaosApp')
.controller('HomeCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.homeByRow = CalaosApp.getSortedHomeByRow();
    $scope.homeRaw = CalaosApp.getHomeData().home;

}]);