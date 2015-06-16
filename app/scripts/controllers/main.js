'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$scope', '$state', 'CalaosApp', '$window', function ($scope, $state, CalaosApp, $window) {

    $scope.CalaosApp = CalaosApp;
    $scope.signOut = function() {
        CalaosApp.signOut();

        $state.go('login');
    };

    $scope.goBack = function () {
        $window.history.back();
    };

    $scope.canGoBack = function () {
        if ($state.is('home.room'))
            return true;

        return false;
    };
}]);
