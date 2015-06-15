'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.CalaosApp = CalaosApp;
    $scope.signOut = function() {
        CalaosApp.signOut();

        $state.go('login');
    };
}]);
