using FluentValidation;
using FluentValidation.TestHelper;
using Prism.Application.Common.Protections;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Common;

/// <summary>
/// RN-PROT-001 a 004: a regra única das proteções da conexão e da pasta. A confirmação tem três valores e "Não" tem uma forma só (a nula);
/// vale a mais forte entre a própria e as das pastas acima, e a origem é a pasta mais próxima que impõe o valor; e a senha do usuário é pedida
/// só pela mudança que afrouxa ou marca o somente leitura de algo que já existia.
/// </summary>
public sealed class ProtectionRulesTests
{
    private static VaultDocument Document(IReadOnlyList<VaultFolderRecord> folders, params VaultConnectionRecord[] connections)
        => new("marina.costa", folders, connections, [], VaultWorkspaceRecord.Empty);

    [Trait("ProtectionRules", "NormalizeConfirmation")]
    [Theory(DisplayName = "OK o branco e o none se gravam nulos, e os outros valores aparados")]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("  ", null)]
    [InlineData("none", null)]
    [InlineData(" none ", null)]
    [InlineData("irreversible", "irreversible")]
    [InlineData(" all ", "all")]
    public void NormalizeConfirmation_ShouldHaveOneFormForNo(string? confirmCommands, string? normalized)
        => Assert.Equal(normalized, ProtectionRules.NormalizeConfirmation(confirmCommands));

    [Trait("ProtectionRules", "ConfirmationIsValid")]
    [Theory(DisplayName = "OK só os três valores da lista, como estão escritos, e o branco")]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("none", true)]
    [InlineData("irreversible", true)]
    [InlineData("all", true)]
    [InlineData(" all ", true)]
    [InlineData("ALL", false)]
    [InlineData("Todos", false)]
    [InlineData("always", false)]
    public void ConfirmationIsValid_ShouldAcceptOnlyTheList(string? confirmCommands, bool valid)
        => Assert.Equal(valid, ProtectionRules.ConfirmationIsValid(confirmCommands));

    [Trait("ProtectionRules", "MustBeAConfirmation")]
    [Fact(DisplayName = "Erro a confirmação fora da lista tem a mensagem da regra")]
    public void MustBeAConfirmation_ShouldHaveTheMessage()
    {
        //Arrange
        var validator = new InlineValidator<ConfirmationHolder>();
        validator.RuleFor(holder => holder.ConfirmCommands).MustBeAConfirmation();

        //Act
        var result = validator.TestValidate(new ConfirmationHolder("sempre"));

        //Assert
        result.ShouldHaveValidationErrorFor(holder => holder.ConfirmCommands).WithErrorMessage("Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.");
    }

    [Trait("ProtectionRules", "ToRecord")]
    [Theory(DisplayName = "OK o somente leitura se grava verdadeiro ou nulo")]
    [InlineData(true, true)]
    [InlineData(false, null)]
    public void ToRecord_ShouldHaveOneFormForUnchecked(bool readOnly, bool? recorded)
        => Assert.Equal(recorded, ProtectionRules.ToRecord(readOnly));

    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK sem proteção em lugar nenhum, nada vale e nada tem origem")]
    public void Of_WithoutProtections_ShouldBeNothing()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var connection = VaultFakers.CreateConnection(folderID: folder.ID);

        //Act
        var protections = ProtectionRules.Of(Document([folder], connection), connection);

        //Assert
        Assert.Equal(new EffectiveProtections(false, null, null, null), protections);
    }

    /// <summary>RN-PROT-004: a pasta impõe a tudo o que está dentro dela, a qualquer profundidade, e a origem é a pasta que impõe.</summary>
    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK o somente leitura e a confirmação de uma pasta valem para a conexão de uma subpasta dela, com a origem")]
    public void Of_ShouldInheritFromEveryFolderAbove()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder(name: "Fábrica") with { ReadOnly = true, ConfirmCommands = "irreversible" };
        var line = VaultFakers.CreateFolder(parentID: factory.ID, name: "Linha 1");
        var cell = VaultFakers.CreateFolder(parentID: line.ID, name: "Célula 3");
        var connection = VaultFakers.CreateConnection(folderID: cell.ID);

        //Act
        var protections = ProtectionRules.Of(Document([factory, line, cell], connection), connection);

        //Assert
        Assert.Equal(new EffectiveProtections(true, factory.ID, "irreversible", factory.ID), protections);
    }

    /// <summary>A origem é a pasta mais próxima que impõe o valor que vale: o somente leitura da mais perto, e a confirmação mais alta.</summary>
    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK a origem do somente leitura é a pasta mais próxima, e a da confirmação é a que tem a mais alta")]
    public void Of_ShouldNameTheClosestFolderThatImposesTheValue()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder(name: "Fábrica") with { ReadOnly = true, ConfirmCommands = "all" };
        var line = VaultFakers.CreateFolder(parentID: factory.ID, name: "Linha 1") with { ReadOnly = true, ConfirmCommands = "irreversible" };
        var connection = VaultFakers.CreateConnection(folderID: line.ID);

        //Act
        var protections = ProtectionRules.Of(Document([factory, line], connection), connection);

        //Assert
        Assert.Equal(new EffectiveProtections(true, line.ID, "all", factory.ID), protections);
    }

    /// <summary>A conexão não afrouxa o que a pasta impõe, e o que ela mesma tem de mais forte é dela (a origem nula).</summary>
    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK o valor próprio mais forte é da conexão, sem origem, e o mais fraco não afrouxa o da pasta")]
    public void Of_ShouldKeepTheStrongest()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ConfirmCommands = "irreversible" };
        var stricter = VaultFakers.CreateConnection(folderID: factory.ID) with { ConfirmCommands = "all", ReadOnly = true };
        var looser = VaultFakers.CreateConnection(folderID: factory.ID) with { ConfirmCommands = null };
        var document = Document([factory], stricter, looser);

        //Act
        var ofStricter = ProtectionRules.Of(document, stricter);
        var ofLooser = ProtectionRules.Of(document, looser);

        //Assert
        Assert.Equal(new EffectiveProtections(true, null, "all", null), ofStricter);
        Assert.Equal(new EffectiveProtections(false, null, "irreversible", factory.ID), ofLooser);
    }

    /// <summary>Na pasta valem as pastas acima dela, e não ela mesma como origem.</summary>
    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK a pasta herda das pastas acima, e a própria proteção não tem origem")]
    public void Of_Folder_ShouldInheritFromTheFoldersAbove()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ReadOnly = true };
        var line = VaultFakers.CreateFolder(parentID: factory.ID) with { ConfirmCommands = "all" };
        var document = Document([factory, line]);

        //Act
        var ofLine = ProtectionRules.Of(document, line);
        var ofFactory = ProtectionRules.Of(document, factory);

        //Assert
        Assert.Equal(new EffectiveProtections(true, factory.ID, "all", null), ofLine);
        Assert.Equal(new EffectiveProtections(true, null, null, null), ofFactory);
    }

    /// <summary>Um documento com ciclo (que a RN-PASTA-003 impede) não prende a subida.</summary>
    [Trait("ProtectionRules", "Of")]
    [Fact(DisplayName = "OK pastas em ciclo não prendem a subida")]
    public void Of_ShouldStopOnACycle()
    {
        //Arrange
        var a = Guid.CreateVersion7();
        var b = Guid.CreateVersion7();
        var first = VaultFakers.CreateFolder(iD: a, parentID: b) with { ConfirmCommands = "irreversible" };
        var second = VaultFakers.CreateFolder(iD: b, parentID: a);
        var connection = VaultFakers.CreateConnection(folderID: a);

        //Act
        var protections = ProtectionRules.Of(Document([first, second], connection), connection);

        //Assert
        Assert.Equal(new EffectiveProtections(false, null, "irreversible", a), protections);
    }

    [Trait("ProtectionRules", "NeedsPassword")]
    [Fact(DisplayName = "OK marcar ou desmarcar o somente leitura da conexão pede a senha")]
    public void NeedsPassword_WhenTheConnectionReadOnlyChanges()
    {
        //Arrange
        var connection = VaultFakers.CreateConnection();
        var before = Document([], connection);
        var marked = Document([], connection with { ReadOnly = true });

        //Act
        var marking = ProtectionRules.NeedsPassword(before, marked);
        var unmarking = ProtectionRules.NeedsPassword(marked, before);

        //Assert
        Assert.True(marking);
        Assert.True(unmarking);
    }

    [Trait("ProtectionRules", "NeedsPassword")]
    [Fact(DisplayName = "OK marcar ou desmarcar o somente leitura da pasta pede a senha, mesmo vazia")]
    public void NeedsPassword_WhenTheFolderReadOnlyChanges()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var before = Document([folder]);
        var marked = Document([folder with { ReadOnly = true }]);

        //Act
        var marking = ProtectionRules.NeedsPassword(before, marked);
        var unmarking = ProtectionRules.NeedsPassword(marked, before);

        //Assert
        Assert.True(marking);
        Assert.True(unmarking);
    }

    /// <summary>RN-PROT-003: tirar o somente leitura herdado também pede: mover a conexão, ou a pasta acima dela, para fora da pasta somente leitura.</summary>
    [Trait("ProtectionRules", "NeedsPassword")]
    [Fact(DisplayName = "OK mover a conexão, ou a pasta dela, para fora de uma pasta somente leitura pede a senha")]
    public void NeedsPassword_WhenAMoveTakesTheInheritedReadOnlyAway()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ReadOnly = true };
        var line = VaultFakers.CreateFolder(parentID: factory.ID);
        var connection = VaultFakers.CreateConnection(folderID: line.ID);
        var before = Document([factory, line], connection);

        //Act
        var connectionMovedOut = ProtectionRules.NeedsPassword(before, Document([factory, line], connection with { FolderID = null }));
        var folderMovedOut = ProtectionRules.NeedsPassword(before, Document([factory, line with { ParentID = null }], connection));

        //Assert
        Assert.True(connectionMovedOut);
        Assert.True(folderMovedOut);
    }

    /// <summary>RN-PROT-003: o que não afrouxa nem marca nada que existia não pede a senha.</summary>
    [Trait("ProtectionRules", "NeedsPassword")]
    [Fact(DisplayName = "OK criar marcada, duplicar, mover para dentro, excluir e mudar a confirmação ou o nome não pedem a senha")]
    public void NeedsPassword_IsNotAskedForWhatDoesNotLoosen()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ReadOnly = true };
        var other = VaultFakers.CreateFolder();
        var connection = VaultFakers.CreateConnection(folderID: other.ID);
        var before = Document([factory, other], connection);

        //Act
        var created = ProtectionRules.NeedsPassword(before, Document([factory, other, VaultFakers.CreateFolder() with { ReadOnly = true }], connection, VaultFakers.CreateConnection() with { ReadOnly = true }));
        var movedIn = ProtectionRules.NeedsPassword(before, Document([factory, other], connection with { FolderID = factory.ID }));
        var deleted = ProtectionRules.NeedsPassword(before, Document([factory, other]));
        var confirmation = ProtectionRules.NeedsPassword(before, Document([factory, other with { ConfirmCommands = "all" }], connection with { ConfirmCommands = "irreversible", Name = "Outro nome" }));
        var inheritedStays = ProtectionRules.NeedsPassword(Document([factory], connection with { FolderID = factory.ID, ReadOnly = true }), Document([factory], connection with { FolderID = factory.ID, ReadOnly = true, Name = "Outro" }));

        //Assert
        Assert.False(created);
        Assert.False(movedIn);
        Assert.False(deleted);
        Assert.False(confirmation);
        Assert.False(inheritedStays);
    }

    /// <summary>A conexão marcada por ela mesma continua somente leitura fora da pasta: mover não tira nada, e não pede a senha.</summary>
    [Trait("ProtectionRules", "NeedsPassword")]
    [Fact(DisplayName = "OK mover para fora da pasta somente leitura a conexão marcada por ela mesma não pede a senha")]
    public void NeedsPassword_IsNotAsked_WhenTheConnectionKeepsItsOwnReadOnly()
    {
        //Arrange
        var factory = VaultFakers.CreateFolder() with { ReadOnly = true };
        var connection = VaultFakers.CreateConnection(folderID: factory.ID) with { ReadOnly = true };

        //Act
        var needs = ProtectionRules.NeedsPassword(Document([factory], connection), Document([factory], connection with { FolderID = null }));

        //Assert
        Assert.False(needs);
    }

    private sealed record ConfirmationHolder(string? ConfirmCommands);
}
