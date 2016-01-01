//Some common functions used in multiple files

function getRoomTypeString(room) {
    var rname = '';
    if (room == "salon") rname = "Salon";
    if (room == "lounge") rname = "Salon";
    if (room == "chambre") rname = "Chambre";
    if (room == "bedroom") rname = "Chambre";
    if (room == "cuisine") rname = "Cuisine";
    if (room == "kitchen") rname = "Cuisine";
    if (room == "bureau") rname = "Bureau";
    if (room == "office") rname = "Bureau";
    if (room == "sam") rname = "Salle a manger";
    if (room == "diningroom") rname = "Salle a manger";
    if (room == "cave") rname = "Cave";
    if (room == "cellar") rname = "Cave";
    if (room == "divers") rname = "Divers";
    if (room == "various") rname = "Divers";
    if (room == "misc") rname = "Divers";
    if (room == "exterieur") rname = "Exterieur";
    if (room == "outside") rname = "Exterieur";
    if (room == "sdb") rname = "Salle de bain";
    if (room == "bathroom") rname = "Salle de bain";
    if (room == "hall") rname = "Couloir";
    if (room == "couloir") rname = "Couloir";
    if (room == "corridor") rname = "Couloir";
    if (room == "garage") rname = "Garage";
    if (room == "Internal") rname = "Internal Room";

    else rname == "Unknown!";

    return rname;
}

function getRoomTypeIcon(room) {
    if (room == "salon") rname = "room_salon.png";
    if (room == "lounge") rname = "room_salon.png";
    if (room == "chambre") rname = "room_chambre.png";
    if (room == "bedroom") rname = "room_chambre.png";
    if (room == "cuisine") rname = "room_cuisine.png";
    if (room == "kitchen") rname = "room_cuisine.png";
    if (room == "bureau") rname = "room_bureau.png";
    if (room == "office") rname = "room_bureau.png";
    if (room == "sam") rname = "room_sam.png";
    if (room == "diningroom") rname = "room_sam.png";
    if (room == "cave") rname = "room_cave.png";
    if (room == "cellar") rname = "room_cave.png";
    if (room == "divers") rname = "room.png";
    if (room == "various") rname = "room.png";
    if (room == "misc") rname = "room.png";
    if (room == "exterieur") rname = "room_exterieur.png";
    if (room == "outside") rname = "room_exterieur.png";
    if (room == "sdb") rname = "room_sdb.png";
    if (room == "bathroom") rname = "room_sdb.png";
    if (room == "hall") rname = "room_corridor.png";
    if (room == "couloir") rname = "room_corridor.png";
    if (room == "corridor") rname = "room_corridor.png";
    if (room == "garage") rname = "room_garage.png";
    if (room == "Internal") rname = "room.png";

    else rname == "room.png";

    return rname;
}

if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return this.slice(0, str.length) == str;
    };
}

if (typeof String.prototype.endsWith != 'function') {
    String.prototype.endsWith = function (str) {
        return this.slice(-str.length) == str;
    };
}
