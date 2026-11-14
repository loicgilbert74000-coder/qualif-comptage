-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1
-- Généré le : sam. 14 nov. 2026 à 12:33
-- Version du serveur : 10.11.16-MariaDB
-- Version de PHP : 8.5.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `db_comptage`
--

-- --------------------------------------------------------

--
-- Structure de la table `mesures_comptage`
--

CREATE TABLE `mesures_comptage` (
  `pk` int(11) NOT NULL,
  `id_pod` varchar(64) NOT NULL COMMENT 'Identifiant unique du POD (Point de Livraison)',
  `date_mesure` datetime NOT NULL COMMENT 'Date et heure de la mesure',
  `valeur` decimal(12,4) NOT NULL COMMENT 'Valeur enregistrée',
  `unite` varchar(32) NOT NULL COMMENT 'Unité de mesure (ex: kWh, m3)',
  `indice_mesure` decimal(12,4) DEFAULT NULL COMMENT 'Indice du compteur (le cas échéant)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Index pour les tables déchargées
--

--
-- Index pour la table `mesures_comptage`
--
ALTER TABLE `mesures_comptage`
  ADD PRIMARY KEY (`pk`);

--
-- AUTO_INCREMENT pour les tables déchargées
--

--
-- AUTO_INCREMENT pour la table `mesures_comptage`
--
ALTER TABLE `mesures_comptage`
  MODIFY `pk` int(11) NOT NULL AUTO_INCREMENT;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
