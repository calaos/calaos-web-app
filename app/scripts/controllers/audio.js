'use strict';

angular.module('calaosApp')
.controller('AudioListCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.audioRaw = CalaosApp.getHomeData().audio;

}]);

angular.module('calaosApp')
.controller('AudioPlayerCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    

}]);
